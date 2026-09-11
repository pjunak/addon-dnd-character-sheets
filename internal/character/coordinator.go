package character

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	model "github.com/pjunak/addon-dnd-engine/character"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
	"io"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

type Data interface {
	Get(context.Context, *workerrpc.Meta, workerrpc.AddonDataReference, string) (workerrpc.AddonDataDocument, error)
	History(context.Context, *workerrpc.Meta, workerrpc.AddonDataReference, string, int64, int) (workerrpc.AddonHistoryResult, error)
	Revision(context.Context, *workerrpc.Meta, workerrpc.AddonDataReference, string, int64) (workerrpc.AddonHistoryEntry, error)
	TransactRecorded(context.Context, *workerrpc.Meta, []workerrpc.AddonDataMutation, workerrpc.RecordedOperation) (workerrpc.AddonDataCommit, error)
}
type Engine interface {
	Call(context.Context, *workerrpc.Meta, workerrpc.ServiceCall) (workerrpc.ServiceResult, error)
}
type Coordinator struct {
	data     Data
	engine   Engine
	now      func() time.Time
	mu       sync.Mutex
	previews map[string]preview
}

func New(data Data, engine Engine) *Coordinator {
	return &Coordinator{data: data, engine: engine, now: time.Now, previews: map[string]preview{}}
}

var operationPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$`)

func (c *Coordinator) HandleRPC(ctx context.Context, rpc workerrpc.Request) (any, error) {
	if rpc.Meta == nil || rpc.Meta.Actor == nil || rpc.Meta.Actor.ID == "" || (rpc.Meta.Actor.Role != "dm" && rpc.Meta.Actor.Role != "player") {
		return nil, failure(workerrpc.KindUnauthorized, "An authenticated character editor is required.")
	}
	var request Request
	if len(rpc.Params) > 190000 || decode(rpc.Params, &request) != nil || request.ContractVersion != "character.v1" || request.Key == "" || len(request.Key) > 200 || request.ExpectedRevision < 0 || request.Revision < 0 || request.Before < 0 {
		return nil, failure(workerrpc.KindInvalidRequest, "Character request is invalid.")
	}
	if request.Change != nil && request.Operation != "play" {
		return nil, failure(workerrpc.KindInvalidRequest, "Play commands require a play operation.")
	}
	response := Response{ContractVersion: "character-response.v1", Status: "ready", Key: request.Key, ActorID: rpc.Meta.Actor.ID, Role: rpc.Meta.Actor.Role}
	method := strings.TrimPrefix(rpc.Method, "service/"+Contract+"/")
	switch method {
	case "history":
		history, err := c.data.History(ctx, rpc.Meta, reference, request.Key, request.Before, 30)
		if err != nil {
			return nil, err
		}
		response.History = history.Entries
		response.NextBefore = history.NextBefore
		return response, nil
	case "revision", "compare":
		entry, err := c.data.Revision(ctx, rpc.Meta, reference, request.Key, request.Revision)
		if err != nil {
			return nil, err
		}
		var state State
		if entry.Deleted || decode(entry.Value, &state) != nil || state.SchemaVersion != SchemaVersion {
			return nil, failure(workerrpc.KindValidationFailed, "This revision is not a current character snapshot.")
		}
		response.State = &state
		response.Revision = entry.Revision
		if method == "compare" {
			if request.CompareRevision < 1 {
				return nil, failure(workerrpc.KindInvalidRequest, "Choose two saved revisions to compare.")
			}
			comparison, err := c.data.Revision(ctx, rpc.Meta, reference, request.Key, request.CompareRevision)
			if err != nil {
				return nil, err
			}
			var after State
			if comparison.Deleted || decode(comparison.Value, &after) != nil || after.SchemaVersion != SchemaVersion {
				return nil, failure(workerrpc.KindValidationFailed, "This revision is not a current character snapshot.")
			}
			response.Changes = diff(&state, &after)
			response.State = &after
			response.Revision = comparison.Revision
		}
		return response, nil
	case "load", "evaluate", "preview", "commit":
	default:
		return nil, workerrpc.NewRPCError(workerrpc.JSONRPCMethodNotFound, workerrpc.KindNotFound, "Character method is unavailable.", false, nil)
	}
	state, revision, err := c.load(ctx, rpc.Meta, request.Key)
	if err != nil {
		return nil, err
	}
	response.State = state
	response.Revision = revision
	if method == "commit" {
		return c.commit(ctx, rpc.Meta, request, response)
	}
	input := model.Blank()
	if state != nil {
		input = state.Inputs
	}
	if method == "preview" || method == "evaluate" {
		if request.ExpectedRevision != revision {
			response.Status = "conflict"
			response.Message = "The saved character changed. Keep your draft and review it against the latest revision."
			return response, nil
		}
		input, err = c.propose(ctx, rpc.Meta, request, state, input)
		if err != nil {
			return nil, err
		}
	}
	if method != "load" || input.Play.AsOf == "" {
		input.Play.AsOf = c.now().UTC().Format(time.RFC3339)
	}
	// Notes have no mechanical dependency. Retain the exact accepted projection
	// and rules identity even when its provider has been disabled or replaced.
	offline := request.Operation == "notes" && state != nil
	var evaluation evaluated
	var rules RulesContext
	if offline {
		input.Play.AsOf = state.Inputs.Play.AsOf
		evaluation.Evaluation = model.Result{ContractVersion: model.ContractVersion, Inputs: input, Sheet: state.Projection.Sheet, Explanations: state.Projection.Explanations, Evidence: state.Projection.Evidence, Issues: state.Projection.Issues, Ready: true}
		rules = state.Rules
	} else {
		evaluation, rules, err = c.evaluate(ctx, rpc.Meta, input, request.Change)
	}
	if err != nil {
		var rpcError *workerrpc.RPCError
		if errors.As(err, &rpcError) && rpcError.Data != nil && (rpcError.Data.Kind == workerrpc.KindInvalidRequest || rpcError.Data.Kind == workerrpc.KindValidationFailed) {
			return nil, err
		}
		response.Status = "unavailable"
		response.Message = "Compatible rules are unavailable. The saved revision remains readable, printable and exportable."
		return response, nil
	}
	// A reduced maximum and its current-HP correction are reviewed atomically.
	// Increasing maximum HP never silently heals the character.
	if state != nil && (request.Operation == "build" || request.Operation == "restore" || request.Operation == "grant" || request.Operation == "amend-grant" || request.Operation == "revoke-grant" || request.Operation == "adopt-rules") {
		if derived, ok := evaluation.Evaluation.Sheet["derived"].(map[string]any); ok {
			if maximum, ok := derived["maxHp"].(float64); ok && maximum >= 0 && input.Play.HP > int(maximum) {
				input.Play.HP = int(maximum)
				evaluation, rules, err = c.evaluate(ctx, rpc.Meta, input, nil)
				if err != nil {
					return nil, err
				}
			}
		}
	}
	response.Evaluation = &evaluation.Evaluation
	response.Policy = evaluation.Policy
	response.RulesChanged = state != nil && !reflect.DeepEqual(state.Rules, rules)
	if method == "load" || method == "evaluate" {
		return response, nil
	}
	if !operationPattern.MatchString(request.OperationID) || strings.TrimSpace(request.Summary) == "" || len(request.Summary) > 1000 {
		return nil, failure(workerrpc.KindInvalidRequest, "A change ID and a brief description are required.")
	}
	next := State{SchemaVersion: SchemaVersion, Inputs: evaluation.Evaluation.Inputs, Projection: Projection{Sheet: evaluation.Evaluation.Sheet, Explanations: evaluation.Evaluation.Explanations, Evidence: evaluation.Evaluation.Evidence, Issues: evaluation.Evaluation.Issues}, Rules: rules, OperationID: request.OperationID}
	// Document limits include the saved explanation/evidence, not the transient
	// catalogs and builder guidance. Never silently truncate character history.
	if len(raw(next)) > 250000 {
		response.Status = "invalid"
		response.Message = "This character snapshot exceeds the storage limit. Reduce authored notes or inventory before committing."
		return response, nil
	}
	response.Changes = diff(state, &next)
	if !evaluation.Evaluation.Ready {
		response.Status = "invalid"
		response.Message = "Resolve the highlighted choices and bounds before saving."
		return response, nil
	}
	if response.RulesChanged && !request.AdoptRules {
		response.Status = "rules-changed"
		response.Message = "Rules or allowed sources changed. Review and explicitly adopt this rules revision."
		return response, nil
	}
	token, err := randomID()
	if err != nil {
		return nil, err
	}
	expires := c.now().Add(15 * time.Minute)
	p := preview{Key: request.Key, ActorID: rpc.Meta.Actor.ID, Role: rpc.Meta.Actor.Role, Generation: rpc.Meta.Generation, OperationID: request.OperationID, Operation: request.Operation, Summary: request.Summary, Revision: revision, Expires: expires, State: next, Offline: offline}
	c.mu.Lock()
	for key, value := range c.previews {
		if !c.now().Before(value.Expires) {
			delete(c.previews, key)
		}
	}
	if len(c.previews) >= 256 {
		c.mu.Unlock()
		return nil, failure(workerrpc.KindRateLimited, "Too many open character reviews.")
	}
	c.previews[token] = p
	c.mu.Unlock()
	response.Token = token
	response.ExpiresAt = expires.UTC().Format(time.RFC3339)
	return response, nil
}

func (c *Coordinator) load(ctx context.Context, meta *workerrpc.Meta, key string) (*State, int64, error) {
	document, err := c.data.Get(ctx, meta, reference, key)
	if err != nil {
		var rpc *workerrpc.RPCError
		if errors.As(err, &rpc) && rpc.Data != nil && rpc.Data.Kind == workerrpc.KindNotFound {
			// A missing extension is not proof that its core record is visible/existing.
			history, accessErr := c.data.History(ctx, meta, reference, key, 0, 1)
			if accessErr != nil {
				return nil, 0, accessErr
			}
			if len(history.Entries) > 0 {
				return nil, 0, failure(workerrpc.KindConflict, "This character head was deleted. Restore it through campaign recovery before editing.")
			}
			return nil, 0, nil
		}
		return nil, 0, err
	}
	var state State
	if decode(document.Value, &state) != nil || state.SchemaVersion != SchemaVersion {
		return nil, 0, failure(workerrpc.KindValidationFailed, "The retired sheet format must be reset through the documented cutover; it cannot be edited as a current character.")
	}
	return &state, document.Revision, nil
}

func (c *Coordinator) propose(ctx context.Context, meta *workerrpc.Meta, r Request, base *State, input model.Inputs) (model.Inputs, error) {
	// Clone before stamping provenance so no caller-owned value is changed.
	_ = json.Unmarshal(raw(input), &input)
	switch r.Operation {
	case "notes":
		if r.Inputs != nil {
			proposed := *r.Inputs
			proposed.Notes = input.Notes
			if !bytes.Equal(raw(proposed), raw(input)) {
				return input, failure(workerrpc.KindInvalidRequest, "Save build or play changes separately from notes.")
			}
			input.Notes = r.Inputs.Notes
		}
	case "build", "inventory", "spells", "adopt-rules":
		if r.Inputs != nil {
			input = *r.Inputs
		}
	case "play":
		if r.Change == nil {
			return input, failure(workerrpc.KindInvalidRequest, "Choose a play action.")
		}
	case "grant", "amend-grant":
		if meta.Actor.Role != "dm" || r.Grant == nil {
			return input, failure(workerrpc.KindUnauthorized, "Only a DM can grant character exceptions.")
		}
		if r.Inputs != nil {
			if !equalGrants(input.Grants, r.Inputs.Grants) {
				return input, failure(workerrpc.KindUnauthorized, "The draft cannot introduce previously unauthorized grants.")
			}
			input = *r.Inputs
		}
		grant := *r.Grant
		grant.ID = "grant-" + r.OperationID
		grant.ActorID = meta.Actor.ID
		grant.GrantedAt = c.now().UTC().Format(time.RFC3339)
		grant.Active = true
		if r.Operation == "amend-grant" {
			found := false
			for index := range input.Grants {
				if input.Grants[index].ID == r.GrantID && input.Grants[index].Active {
					input.Grants[index].Active = false
					found = true
				}
			}
			if !found {
				return input, failure(workerrpc.KindNotFound, "The active grant to amend was not found.")
			}
		}
		if strings.TrimSpace(grant.Reason) == "" {
			return input, failure(workerrpc.KindInvalidRequest, "Explain why this DM grant was given.")
		}
		for _, existing := range input.Grants {
			if existing.ID == grant.ID {
				return input, failure(workerrpc.KindConflict, "This grant already exists.")
			}
		}
		input.Grants = append(input.Grants, grant)
		if grant.ItemID != "" {
			for index := range input.Play.Inventory {
				if input.Play.Inventory[index].ID == grant.ItemID {
					input.Play.Inventory[index].GrantID = grant.ID
				}
			}
		}
	case "revoke-grant":
		if meta.Actor.Role != "dm" {
			return input, failure(workerrpc.KindUnauthorized, "Only a DM can revoke a grant.")
		}
		found := false
		for index := range input.Grants {
			if input.Grants[index].ID == r.GrantID {
				input.Grants[index].Active = false
				found = true
			}
		}
		if !found {
			return input, failure(workerrpc.KindNotFound, "This grant was not found.")
		}
	case "restore":
		entry, err := c.data.Revision(ctx, meta, reference, r.Key, r.Revision)
		if err != nil {
			return input, err
		}
		var previous State
		if entry.Deleted || decode(entry.Value, &previous) != nil || previous.SchemaVersion != SchemaVersion {
			return input, failure(workerrpc.KindValidationFailed, "Only current character snapshots can be restored.")
		}
		switch r.RestoreScope {
		case "", "build":
			acquisitions := input.Build.Spells.Acquisitions
			input.Build = previous.Inputs.Build
			input.Build.Spells.Acquisitions = acquisitions
			for _, acquisition := range acquisitions {
				if input.Build.Spells.Spellbook == nil {
					input.Build.Spells.Spellbook = map[string][]string{}
				}
				found := false
				for _, id := range input.Build.Spells.Spellbook[acquisition.ClassID] {
					found = found || id == acquisition.SpellID
				}
				if !found {
					input.Build.Spells.Spellbook[acquisition.ClassID] = append(input.Build.Spells.Spellbook[acquisition.ClassID], acquisition.SpellID)
				}
			}
			input.Grants = previous.Inputs.Grants
		case "play":
			input.Play = previous.Inputs.Play
		case "complete":
			input = previous.Inputs
		default:
			return input, failure(workerrpc.KindInvalidRequest, "Choose build, play or complete restoration.")
		}
	case "import":
		if r.Inputs == nil {
			return input, failure(workerrpc.KindInvalidRequest, "Import requires current-format character inputs.")
		}
		input = *r.Inputs
		for index := range input.Build.Rolls {
			input.Build.Rolls[index].Origin = "import"
		}
		for index := range input.Play.Rolls {
			input.Play.Rolls[index].Origin = "import"
		}
		for index := range input.Build.Spells.Acquisitions {
			input.Build.Spells.Acquisitions[index].Origin = "import"
		}
		for index := range input.Build.Spells.Swaps {
			input.Build.Spells.Swaps[index].Origin = "import"
		}
		if len(input.Grants) > 0 {
			if meta.Actor.Role != "dm" || !r.ReauthorizeGrants {
				return input, failure(workerrpc.KindUnauthorized, "Imported DM grants must be reviewed and authorized by the current DM.")
			}
			grantIDs := map[string]string{}
			for i := range input.Grants {
				oldID := input.Grants[i].ID
				input.Grants[i].ID = fmt.Sprintf("grant-%s-%d", r.OperationID, i)
				grantIDs[oldID] = input.Grants[i].ID
				input.Grants[i].ActorID = meta.Actor.ID
				input.Grants[i].GrantedAt = c.now().UTC().Format(time.RFC3339)
			}
			for i := range input.Play.Inventory {
				if id := input.Play.Inventory[i].GrantID; id != "" {
					input.Play.Inventory[i].GrantID = grantIDs[id]
				}
			}
		}
	default:
		return input, failure(workerrpc.KindInvalidRequest, "Choose a supported character change.")
	}
	if r.Operation != "grant" && r.Operation != "amend-grant" && r.Operation != "revoke-grant" && r.Operation != "import" {
		grants := []model.Grant{}
		if base != nil {
			grants = base.Inputs.Grants
		}
		if !equalGrants(grants, input.Grants) {
			if r.Operation != "restore" || meta.Actor.Role != "dm" || !r.ReauthorizeGrants {
				return input, failure(workerrpc.KindUnauthorized, "DM grants can only change through a DM grant, revocation, or explicitly authorized restore.")
			}
		}
	}
	if r.Operation != "restore" && r.Operation != "import" {
		previous := model.Blank()
		if base != nil {
			previous = base.Inputs
		}
		if !bytes.Equal(raw(input.Play.Rolls), raw(previous.Play.Rolls)) || !bytes.Equal(raw(input.Build.Spells.Acquisitions), raw(previous.Build.Spells.Acquisitions)) || !bytes.Equal(raw(input.Build.Spells.Swaps), raw(previous.Build.Spells.Swaps)) {
			return input, failure(workerrpc.KindUnauthorized, "Recorded play rolls and spell acquisitions can only change through their play commands or an explicit restoration.")
		}
	}
	return input, nil
}
func (c *Coordinator) evaluate(ctx context.Context, meta *workerrpc.Meta, input model.Inputs, change map[string]any) (evaluated, RulesContext, error) {
	method := "evaluate-character"
	params := map[string]any{"contractVersion": model.ContractVersion, "inputs": input}
	if change != nil {
		method = "character-play"
		params["change"] = change
	}
	result, err := c.engine.Call(ctx, meta, workerrpc.ServiceCall{Contract: "dnd5e.rules-engine", Method: method, Params: params})
	if err != nil {
		return evaluated{}, RulesContext{}, err
	}
	var value evaluated
	if decode(result.Result, &value) != nil || value.ContractVersion != "rules-character-response.v1" || value.Evaluation.ContractVersion != model.ContractVersion {
		return value, RulesContext{}, failure(workerrpc.KindValidationFailed, "Rules returned an incompatible character result.")
	}
	return value, RulesContext{EngineID: result.ProviderAddonID, EngineVersion: result.ProviderContractVersion, EngineGeneration: result.ProviderGeneration, Identity: value.Identity}, nil
}

func (c *Coordinator) commit(ctx context.Context, meta *workerrpc.Meta, r Request, response Response) (Response, error) {
	// A lost response can be resolved after a worker restart without its transient
	// review token. The saved operation already passed actor-bound authorization.
	if response.State != nil && response.State.OperationID == r.OperationID && operationPattern.MatchString(r.OperationID) {
		return response, nil
	}
	c.mu.Lock()
	p, ok := c.previews[r.Token]
	c.mu.Unlock()
	if !ok || !c.now().Before(p.Expires) || p.ActorID != meta.Actor.ID || p.Role != meta.Actor.Role || p.Generation != meta.Generation || p.Key != r.Key || p.OperationID != r.OperationID {
		return response, failure(workerrpc.KindConflict, "This review expired or belongs to another session. Keep the draft and review again.")
	}
	// A confirmed repeated commit returns the saved result without replaying it.
	if response.State != nil && response.State.OperationID == p.OperationID {
		return response, nil
	}
	if response.Revision != p.Revision || r.ExpectedRevision != p.Revision {
		response.Status = "conflict"
		response.Message = "The character changed since this review. Your draft is preserved."
		return response, nil
	}
	for _, grant := range p.State.Inputs.Grants {
		if expiry, err := time.Parse(time.RFC3339, grant.ExpiresAt); err == nil && grant.Active {
			asOf, _ := time.Parse(time.RFC3339, p.State.Inputs.Play.AsOf)
			if asOf.Before(expiry) && !c.now().Before(expiry) {
				return response, failure(workerrpc.KindConflict, "A DM grant expired during this review. Review its consequences again.")
			}
		}
	}
	if !p.Offline {
		evaluation, rules, err := c.evaluate(ctx, meta, p.State.Inputs, nil)
		if err != nil {
			return response, err
		}
		if !reflect.DeepEqual(rules, p.State.Rules) || !evaluation.Evaluation.Ready || !reflect.DeepEqual(raw(evaluation.Evaluation.Sheet), raw(p.State.Projection.Sheet)) {
			response.Status = "rules-changed"
			response.Message = "Rules changed during review. Review the character again."
			return response, nil
		}
	}
	receipt, err := c.data.TransactRecorded(ctx, meta, []workerrpc.AddonDataMutation{{Operation: "put", Reference: reference, Key: p.Key, ExpectedRevision: p.Revision, Value: p.State}}, workerrpc.RecordedOperation{ID: p.OperationID, Operation: "character." + p.Operation, Summary: p.Summary})
	if err != nil {
		return response, err
	}
	if len(receipt.Results) != 1 {
		return response, errors.New("invalid character commit receipt")
	}
	response.Revision = receipt.Results[0].AfterRevision
	response.State = &p.State
	response.Message = "Character revision saved."
	return response, nil
}
func equalGrants(a, b []model.Grant) bool {
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	return reflect.DeepEqual(a, b)
}
func failure(kind, message string) error {
	return workerrpc.NewRPCError(workerrpc.JSONRPCApplication, kind, message, false, nil)
}
func decode(body []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(body))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return errors.New("unexpected trailing JSON")
	}
	return nil
}
func randomID() (string, error) {
	value := make([]byte, 24)
	_, err := rand.Read(value)
	return hex.EncodeToString(value), err
}
func diff(before, after *State) []Difference {
	var a, b map[string]any
	if before != nil {
		_ = json.Unmarshal(raw(before), &a)
	}
	_ = json.Unmarshal(raw(after), &b)
	result := []Difference{}
	var walk func(string, any, any)
	walk = func(path string, left, right any) {
		if reflect.DeepEqual(left, right) {
			return
		}
		l, lok := left.(map[string]any)
		r, rok := right.(map[string]any)
		if lok && rok {
			keys := map[string]bool{}
			for k := range l {
				keys[k] = true
			}
			for k := range r {
				keys[k] = true
			}
			ordered := []string{}
			for k := range keys {
				ordered = append(ordered, k)
			}
			sort.Strings(ordered)
			for _, k := range ordered {
				walk(path+"/"+k, l[k], r[k])
			}
			return
		}
		result = append(result, Difference{Path: path, Before: left, After: right})
	}
	for _, key := range []string{"inputs", "rules", "projection"} {
		walk("/"+key, a[key], b[key])
	}
	return result
}
