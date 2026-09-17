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
	Transact(context.Context, *workerrpc.Meta, []workerrpc.AddonDataMutation) (workerrpc.AddonDataCommit, error)
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
	if len(rpc.Params) > 190000 || decode(rpc.Params, &request) != nil || request.ContractVersion != "character.v2" || request.Key == "" || len(request.Key) > 200 || request.ExpectedRevision < 0 {
		return nil, failure(workerrpc.KindInvalidRequest, "Character request is invalid.")
	}
	if request.Change != nil && request.Operation != "play" {
		return nil, failure(workerrpc.KindInvalidRequest, "Play commands require a play operation.")
	}
	response := Response{ContractVersion: "character-response.v2", Status: "ready", Key: request.Key, ActorID: rpc.Meta.Actor.ID, Role: rpc.Meta.Actor.Role}
	method := strings.TrimPrefix(rpc.Method, "service/"+Contract+"/")
	switch method {
	case "load", "evaluate", "preview", "commit", "save":
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
	if method == "save" && state != nil && state.OperationID == request.OperationID && operationPattern.MatchString(request.OperationID) {
		return response, nil
	}
	if method == "preview" || method == "evaluate" || method == "save" {
		if request.ExpectedRevision != revision {
			response.Status = "conflict"
			response.Message = "The character changed in another session. Reload before editing the same values."
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
		response.Message = "Compatible rules are unavailable. The saved character remains readable, printable and exportable."
		return response, nil
	}
	// A reduced maximum and its current-HP correction are saved atomically.
	// Increasing maximum HP never silently heals the character.
	if state != nil && (request.Operation == "build" || request.Operation == "grant" || request.Operation == "amend-grant" || request.Operation == "revoke-grant" || request.Operation == "adopt-rules") {
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
	// Structural edits can withdraw earlier grants. Remove only previously
	// saved selections that the engine now marks as unavailable; a newly
	// supplied illegal option is still rejected.
	repairChoices := request.Operation == "build" || request.Operation == "amend-grant" || request.Operation == "revoke-grant"
	if repairChoices && state != nil {
		// Each pass removes at least one saved selection, so dependent grants
		// settle without an arbitrary depth limit.
		for {
			invalid := map[string]bool{}
			for _, issue := range evaluation.Evaluation.Issues {
				for _, prefix := range []string{"unavailable-choice:", "invalid-option:", "choice-count:"} {
					if key, ok := strings.CutPrefix(issue.ID, prefix); ok {
						invalid[key] = true
					}
				}
			}
			kept := []model.Choice{}
			for _, choice := range input.Build.Choices {
				previous := false
				for _, old := range state.Inputs.Build.Choices {
					previous = previous || reflect.DeepEqual(old, choice)
				}
				if !invalid[fmt.Sprintf("%s#%d", choice.ID, choice.Slot)] || !previous {
					kept = append(kept, choice)
				}
			}
			if len(kept) == len(input.Build.Choices) {
				break
			}
			input.Build.Choices = kept
			evaluation, rules, err = c.evaluate(ctx, rpc.Meta, input, nil)
			if err != nil {
				return nil, err
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
	// catalogs and builder guidance.
	if len(raw(next)) > 250000 {
		response.Status = "invalid"
		response.Message = "This character snapshot exceeds the storage limit. Reduce authored notes or inventory before committing."
		return response, nil
	}
	response.Changes = diff(state, &next)
	if !saveable(evaluation.Evaluation) {
		response.Status = "invalid"
		response.Message = "This change is outside the character rules."
		return response, nil
	}
	if response.RulesChanged && !request.AdoptRules {
		response.Status = "rules-changed"
		response.Message = "Rules or allowed sources changed. Review and explicitly adopt this rules revision."
		return response, nil
	}
	if method == "save" {
		if request.Operation == "import" {
			return response, failure(workerrpc.KindInvalidRequest, "Imports require replacement review.")
		}
		return c.persist(ctx, rpc.Meta, request.Key, revision, next, response)
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
				return input, failure(workerrpc.KindUnauthorized, "This edit cannot introduce previously unauthorized grants.")
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
					grant.ID = r.GrantID
					input.Grants = append(input.Grants[:index], input.Grants[index+1:]...)
					found = true
					break
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
				input.Grants = append(input.Grants[:index], input.Grants[index+1:]...)
				found = true
				break
			}
		}
		if !found {
			return input, failure(workerrpc.KindNotFound, "This grant was not found.")
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
			return input, failure(workerrpc.KindUnauthorized, "DM grants require a DM grant command.")
		}
	}
	if r.Operation != "import" {
		previous := model.Blank()
		if base != nil {
			previous = base.Inputs
		}
		if !bytes.Equal(raw(input.Play.Rolls), raw(previous.Play.Rolls)) || !bytes.Equal(raw(input.Build.Spells.Acquisitions), raw(previous.Build.Spells.Acquisitions)) || !bytes.Equal(raw(input.Build.Spells.Swaps), raw(previous.Build.Spells.Swaps)) {
			return input, failure(workerrpc.KindUnauthorized, "Recorded play rolls and spell acquisitions can only change through their play commands.")
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
		return response, failure(workerrpc.KindConflict, "This review expired or belongs to another session. Review again.")
	}
	// A confirmed repeated commit returns the saved result without replaying it.
	if response.State != nil && response.State.OperationID == p.OperationID {
		return response, nil
	}
	if response.Revision != p.Revision || r.ExpectedRevision != p.Revision {
		response.Status = "conflict"
		response.Message = "The character changed since this review."
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
		if !reflect.DeepEqual(rules, p.State.Rules) || !saveable(evaluation.Evaluation) || !reflect.DeepEqual(raw(evaluation.Evaluation.Sheet), raw(p.State.Projection.Sheet)) {
			response.Status = "rules-changed"
			response.Message = "Rules changed during review. Review the character again."
			return response, nil
		}
	}
	return c.persist(ctx, meta, p.Key, p.Revision, p.State, response)
}
func saveable(result model.Result) bool { return result.Ready || result.Guidance["canSave"] == true }
func (c *Coordinator) persist(ctx context.Context, meta *workerrpc.Meta, key string, revision int64, state State, response Response) (Response, error) {
	receipt, err := c.data.Transact(ctx, meta, []workerrpc.AddonDataMutation{{Operation: "put", Reference: reference, Key: key, ExpectedRevision: revision, Value: state}})
	if err != nil {
		return response, err
	}
	if len(receipt.Results) != 1 {
		return response, errors.New("invalid character save receipt")
	}
	response.Revision = receipt.Results[0].AfterRevision
	response.State = &state
	response.RulesChanged = false
	response.Message = "Saved"
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
