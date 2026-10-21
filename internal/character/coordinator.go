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
	"slices"
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

// storedLimit keeps a saved sheet under the host's 256 KiB document limit.
// Character data itself is bounded by the Engine's published
// model.MaxRequestBytes, checked on every Engine payload before calling.
const storedLimit = 250000

func (c *Coordinator) HandleRPC(ctx context.Context, rpc workerrpc.Request) (any, error) {
	if rpc.Meta == nil || rpc.Meta.Actor == nil || rpc.Meta.Actor.ID == "" || (rpc.Meta.Actor.Role != "dm" && rpc.Meta.Actor.Role != "player") {
		return nil, failure(workerrpc.KindUnauthorized, "An authenticated character editor is required.")
	}
	var request Request
	if decode(rpc.Params, &request) != nil || request.ContractVersion != "character.v3" || request.Key == "" || len(request.Key) > 200 || request.ExpectedRevision < 0 {
		return nil, failure(workerrpc.KindInvalidRequest, "Character request is invalid.")
	}
	if request.Change != nil && request.Operation != "play" {
		return nil, failure(workerrpc.KindInvalidRequest, "Play commands require a play operation.")
	}
	response := Response{ContractVersion: "character-response.v3", Status: "ready", Key: request.Key, ActorID: rpc.Meta.Actor.ID, Role: rpc.Meta.Actor.Role}
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
	carriesGrants := (request.Operation == "build" || request.Operation == "adopt-rules") && state != nil && !equalGrants(state.Inputs.Grants, input.Grants)
	if method != "load" || input.Play.AsOf == "" {
		input.Play.AsOf = c.now().UTC().Format(time.RFC3339)
	}
	evaluation, rules, err := c.evaluate(ctx, rpc.Meta, input, request.Change)
	if err != nil {
		var large tooLargeError
		if errors.As(err, &large) {
			// Nothing is evaluated or saved, so the answer has no rules status.
			// A saved character too large for the Engine stays readable, as it
			// does without compatible rules.
			response.Status = "too-large"
			response.Message = large.Error()
			if method == "load" {
				response.Status = "unavailable"
				response.Message = fmt.Sprintf("This character is %d bytes; the rules engine accepts at most %d. The saved character remains readable, printable and exportable.", large.size, model.MaxRequestBytes)
			}
			return response, nil
		}
		var rpcError *workerrpc.RPCError
		rejected := method != "load" && errors.As(err, &rpcError) && rpcError.Data != nil && (rpcError.Data.Kind == workerrpc.KindInvalidRequest || rpcError.Data.Kind == workerrpc.KindValidationFailed)
		// The rules refused this play action, so nothing is saved. Answer with
		// the reason so the sheet can show it next to the action.
		if rejected && request.Change != nil {
			response.Status = "invalid"
			response.Message = rpcError.Message
			return response, nil
		}
		// Reading depends on our saved schema, not a replacement provider's
		// contract. Edit validation must still reach the caller unchanged.
		if rejected {
			return nil, err
		}
		response.Status = "unavailable"
		response.Message = "Compatible rules are unavailable. The saved character remains readable, printable and exportable."
		return response, nil
	}
	// A sheet saved in an older format keeps its inputs; its projection is
	// recomputed from them, and the next save stores it.
	if method == "load" && state != nil && state.upgraded {
		state.Projection = projectionOf(evaluation.Evaluation)
	}
	// Structural edits and newly adopted rules can withdraw earlier grants.
	// Remove only previously saved selections that the engine now marks as
	// unavailable, and report them; a newly supplied illegal option is still
	// rejected.
	repairChoices := request.Operation == "build" || request.Operation == "amend-grant" || request.Operation == "revoke-grant" || request.Operation == "adopt-rules"
	if repairChoices && state != nil {
		proposed := cloneInputs(input)
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
			repairedGrants := repairGrantSelections(&input, state.Inputs, evaluation.Evaluation)
			if len(kept) == len(input.Build.Choices) && !repairedGrants {
				break
			}
			input.Build.Choices = kept
			evaluation, rules, err = c.evaluate(ctx, rpc.Meta, input, nil)
			if err != nil {
				return nil, err
			}
		}
		response.Withdrawn = withdrawn(proposed, input)
	}
	response.Evaluation = &evaluation.Evaluation
	response.Policy = evaluation.Policy
	response.RulesChanged = state != nil && !reflect.DeepEqual(state.Rules, rules)
	// Grant changes travel with edits only until changed rules are adopted;
	// otherwise they need their own commands.
	if carriesGrants && !response.RulesChanged {
		return nil, failure(workerrpc.KindUnauthorized, "DM grants require a DM grant command.")
	}
	if method == "load" || method == "evaluate" {
		return response, nil
	}
	if !operationPattern.MatchString(request.OperationID) {
		return nil, failure(workerrpc.KindInvalidRequest, "A change ID is required.")
	}
	next := State{SchemaVersion: SchemaVersion, Inputs: evaluation.Evaluation.Inputs, Projection: projectionOf(evaluation.Evaluation), Rules: rules, OperationID: request.OperationID}
	// A saved character must stay small enough to evaluate again. The document
	// limit includes the saved explanations and evidence, not the transient
	// catalogs and builder guidance.
	if size := len(raw(payload(next.Inputs, nil))); size > model.MaxRequestBytes {
		response.Status = "too-large"
		response.Message = tooLargeMessage(size)
		return response, nil
	}
	if size := len(raw(next)); size > storedLimit {
		response.Status = "too-large"
		response.Message = fmt.Sprintf("This character's saved snapshot would be %d bytes; the storage limit is %d. It keeps rules evidence for each referenced class, feat, spell and item, so remove entries the character no longer needs, then try again.", size, storedLimit)
		return response, nil
	}
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
	response.Changes = diff(state, &next)
	token, err := randomID()
	if err != nil {
		return nil, err
	}
	expires := c.now().Add(15 * time.Minute)
	p := preview{Key: request.Key, ActorID: rpc.Meta.Actor.ID, Role: rpc.Meta.Actor.Role, Generation: rpc.Meta.Generation, OperationID: request.OperationID, Revision: revision, Expires: expires, State: next}
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
			// A removed sheet keeps its revision; the next save must expect it.
			revision, _ := workerrpc.DeletedRevision(err)
			return nil, revision, nil
		}
		return nil, 0, err
	}
	state, err := decodeState(document.Value)
	if err != nil {
		return nil, 0, failure(workerrpc.KindValidationFailed, "This saved sheet uses an unsupported format and cannot be edited.")
	}
	return &state, document.Revision, nil
}

func (c *Coordinator) propose(ctx context.Context, meta *workerrpc.Meta, r Request, base *State, input model.Inputs) (model.Inputs, error) {
	// Clone before stamping provenance so no caller-owned value is changed.
	input = cloneInputs(input)
	if r.Inputs != nil {
		proposed := cloneInputs(*r.Inputs)
		r.Inputs = &proposed
	}
	switch r.Operation {
	case "build", "adopt-rules":
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
		amendIndex := -1
		if r.Operation == "amend-grant" {
			found := false
			for index := range input.Grants {
				if input.Grants[index].ID == r.GrantID && input.Grants[index].Active {
					grant.ID = r.GrantID
					amendIndex = index
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
		for index, existing := range input.Grants {
			if existing.ID == grant.ID && index != amendIndex {
				return input, failure(workerrpc.KindConflict, "This grant already exists.")
			}
		}
		if amendIndex >= 0 {
			input.Grants[amendIndex] = grant
		} else {
			input.Grants = append(input.Grants, grant)
		}
		linkGrantItem(&input, grant.ID, grant.ItemID)
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
		linkGrantItem(&input, r.GrantID, "")
	case "import":
		imported, err := c.importedInputs(meta, r)
		if err != nil {
			return input, err
		}
		input = imported
	default:
		return input, failure(workerrpc.KindInvalidRequest, "Choose a supported character change.")
	}
	if r.Operation != "grant" && r.Operation != "amend-grant" && r.Operation != "revoke-grant" && r.Operation != "import" {
		grants := []model.Grant{}
		if base != nil {
			grants = base.Inputs.Grants
		}
		if !equalGrants(grants, input.Grants) {
			// A DM's revocations and amendments can travel with pending edits
			// while changed rules wait for adoption; HandleRPC refuses them
			// once the rules are current.
			if meta.Actor.Role != "dm" || (r.Operation != "build" && r.Operation != "adopt-rules") {
				return input, failure(workerrpc.KindUnauthorized, "DM grants require a DM grant command.")
			}
			if err := c.carryGrantChanges(meta, grants, &input); err != nil {
				return input, err
			}
		}
	}
	if r.Operation != "import" {
		previous := model.Blank()
		if base != nil {
			previous = base.Inputs
		}
		if !bytes.Equal(raw(input.Play.Rolls), raw(previous.Play.Rolls)) || !bytes.Equal(raw(input.Build.Spells.Acquisitions), raw(previous.Build.Spells.Acquisitions)) || !bytes.Equal(raw(input.Build.Spells.Swaps), raw(previous.Build.Spells.Swaps)) || !slices.Equal(input.Build.Replacements, previous.Build.Replacements) {
			return input, failure(workerrpc.KindUnauthorized, "Recorded rolls, spell acquisitions and class replacements can only change through their play commands.")
		}
	}
	return input, nil
}

// carryGrantChanges checks the grant revocations and amendments a DM's pending
// edits carry, and records them as revoke-grant and amend-grant do. A new
// grant still needs its own command.
func (c *Coordinator) carryGrantChanges(meta *workerrpc.Meta, saved []model.Grant, input *model.Inputs) error {
	previous := map[string]model.Grant{}
	for _, grant := range saved {
		previous[grant.ID] = grant
	}
	kept := map[string]bool{}
	for index := range input.Grants {
		grant := &input.Grants[index]
		old, existed := previous[grant.ID]
		if !existed || kept[grant.ID] {
			return failure(workerrpc.KindUnauthorized, "DM grants require a DM grant command.")
		}
		kept[grant.ID] = true
		if reflect.DeepEqual(old, *grant) {
			continue
		}
		if !old.Active {
			return failure(workerrpc.KindNotFound, "The active grant to amend was not found.")
		}
		if strings.TrimSpace(grant.Reason) == "" {
			return failure(workerrpc.KindInvalidRequest, "Explain why this DM grant was given.")
		}
		grant.ActorID = meta.Actor.ID
		grant.GrantedAt = c.now().UTC().Format(time.RFC3339)
		grant.Active = true
		linkGrantItem(input, grant.ID, grant.ItemID)
	}
	for _, grant := range saved {
		if !kept[grant.ID] {
			linkGrantItem(input, grant.ID, "")
		}
	}
	return nil
}

// Decode into a fresh value: unmarshalling over existing slices and maps can
// overwrite the saved state needed for authorization and withdrawal repair.
func cloneInputs(input model.Inputs) model.Inputs {
	var detached model.Inputs
	_ = json.Unmarshal(raw(input), &detached)
	return detached
}

func linkGrantItem(input *model.Inputs, grantID, itemID string) {
	for index := range input.Play.Inventory {
		item := &input.Play.Inventory[index]
		if item.GrantID == grantID {
			item.GrantID = ""
		}
		if itemID != "" && item.ID == itemID {
			item.GrantID = grantID
		}
	}
}

// payload is the Engine request for one evaluation or play command.
func payload(input model.Inputs, change *model.PlayCommand) map[string]any {
	params := map[string]any{"contractVersion": model.ContractVersion, "inputs": input}
	if change != nil {
		params["change"] = change
	}
	return params
}

// tooLargeError reports an Engine payload over the Engine's published limit.
type tooLargeError struct{ size int }

func (e tooLargeError) Error() string { return tooLargeMessage(e.size) }

func tooLargeMessage(size int) string {
	return fmt.Sprintf("This character is %d bytes; the rules engine accepts at most %d. Remove inventory entries or shorten item notes, then try again.", size, model.MaxRequestBytes)
}

func (c *Coordinator) evaluate(ctx context.Context, meta *workerrpc.Meta, input model.Inputs, change *model.PlayCommand) (evaluated, RulesContext, error) {
	method := "evaluate-character"
	if change != nil {
		method = "character-play"
	}
	params := payload(input, change)
	// The Engine would refuse a larger request with a generic error.
	if size := len(raw(params)); size > model.MaxRequestBytes {
		return evaluated{}, RulesContext{}, tooLargeError{size}
	}
	result, err := c.engine.Call(ctx, meta, workerrpc.ServiceCall{Contract: "dnd5e.rules-engine", Method: method, Params: params})
	if err != nil {
		return evaluated{}, RulesContext{}, err
	}
	var value evaluated
	if decode(result.Result, &value) != nil || value.ContractVersion != model.ResponseVersion || value.Evaluation.ContractVersion != model.ContractVersion || !reflect.DeepEqual(input.Play.Inspiration, value.Evaluation.Inputs.Play.Inspiration) || !slices.Equal(input.Play.Conditions, value.Evaluation.Inputs.Play.Conditions) || !slices.Equal(input.Play.QuickUse, value.Evaluation.Inputs.Play.QuickUse) || !preservesEquipment(input.Play, value.Evaluation.Inputs.Play, change) || !preservesClassReplacements(input, value.Evaluation.Inputs, change) {
		return value, RulesContext{}, failure(workerrpc.KindValidationFailed, "Rules returned an incompatible character result.")
	}
	return value, RulesContext{EngineID: result.ProviderAddonID, EngineVersion: result.ProviderContractVersion, EngineGeneration: result.ProviderGeneration, Identity: value.Identity}, nil
}

// Evaluation and play commands must not silently reorganize authored storage.
func preservesStorage(before, after model.Play) bool {
	if !slices.Equal(before.Containers, after.Containers) {
		return false
	}
	membership := func(play model.Play) map[string]string {
		result := map[string]string{}
		for _, item := range play.Inventory {
			if item.ContainerID != "" {
				result[item.ID] = item.ContainerID
			}
		}
		return result
	}
	return reflect.DeepEqual(membership(before), membership(after))
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
	evaluation, rules, err := c.evaluate(ctx, meta, p.State.Inputs, nil)
	if err != nil {
		return response, err
	}
	if !reflect.DeepEqual(rules, p.State.Rules) || !saveable(evaluation.Evaluation) || !reflect.DeepEqual(raw(evaluation.Evaluation.Sheet), raw(p.State.Projection.Sheet)) {
		response.Status = "rules-changed"
		response.Message = "Rules changed during review. Review the character again."
		return response, nil
	}
	return c.persist(ctx, meta, p.Key, p.Revision, p.State, response)
}

// projectionOf is the part of an evaluation a saved sheet keeps.
func projectionOf(result model.Result) Projection {
	return Projection{Sheet: result.Sheet, Explanations: result.Explanations, Evidence: result.Evidence, Issues: result.Issues}
}

func saveable(result model.Result) bool { return result.Ready || result.Guidance.CanSave }
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

// withdrawn lists the saved selections a repair removed. Choices are listed
// one by one; the other repaired selections are map entries.
func withdrawn(before, after model.Inputs) []Difference {
	result := []Difference{}
	kept := map[string]bool{}
	for _, choice := range after.Build.Choices {
		kept[fmt.Sprintf("%s#%d", choice.ID, choice.Slot)] = true
	}
	for _, choice := range before.Build.Choices {
		if !kept[fmt.Sprintf("%s#%d", choice.ID, choice.Slot)] {
			var value any
			_ = json.Unmarshal(choice.Value, &value)
			result = append(result, Difference{Path: "/inputs/build/choices/" + choice.ID, Before: value})
		}
	}
	before.Build.Choices, after.Build.Choices = nil, nil
	return append(result, diff(&State{Inputs: before}, &State{Inputs: after})...)
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
			start := len(result)
			for _, k := range ordered {
				walk(path+"/"+k, l[k], r[k])
				// Each of the three review groups gets part of the service's
				// 500-entry bound. Collapse a large subtree without truncating
				// its before/after values or changing the immutable review.
				if len(result)-start > 500/3 {
					result = append(result[:start], Difference{Path: path, Before: left, After: right})
					return
				}
			}
			return
		}
		result = append(result, Difference{Path: path, Before: left, After: right})
	}
	for _, key := range []string{"inputs", "rules"} {
		walk("/"+key, a[key], b[key])
	}
	var leftSheet any
	if projection, ok := a["projection"].(map[string]any); ok {
		leftSheet = projection["sheet"]
	}
	walk("/projection/sheet", leftSheet, b["projection"].(map[string]any)["sheet"])
	return result
}
