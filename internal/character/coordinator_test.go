package character

import (
	"context"
	"encoding/json"
	model "github.com/pjunak/addon-dnd-engine/character"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
	"reflect"
	"testing"
	"time"
)

type memoryData struct {
	state     *State
	revision  int64
	writes    int
	forbidden bool
}

func (data *memoryData) Get(_ context.Context, _ *workerrpc.Meta, _ workerrpc.AddonDataReference, key string) (workerrpc.AddonDataDocument, error) {
	if data.forbidden {
		return workerrpc.AddonDataDocument{}, failure(workerrpc.KindUnauthorized, "hidden character")
	}
	if data.state == nil {
		return workerrpc.AddonDataDocument{}, failure(workerrpc.KindNotFound, "missing")
	}
	return workerrpc.AddonDataDocument{Key: key, Revision: data.revision, Value: raw(data.state)}, nil
}
func (data *memoryData) Transact(_ context.Context, _ *workerrpc.Meta, mutations []workerrpc.AddonDataMutation) (workerrpc.AddonDataCommit, error) {
	m := mutations[0]
	if m.ExpectedRevision != data.revision {
		return workerrpc.AddonDataCommit{}, failure(workerrpc.KindConflict, "changed")
	}
	state := m.Value.(State)
	data.state = &state
	data.revision++
	data.writes++
	return workerrpc.AddonDataCommit{Results: []workerrpc.AddonDataMutationResult{{AfterRevision: data.revision}}}, nil
}

type fakeEngine struct {
	inspect     func(model.Inputs) []model.Issue
	generation  string
	unavailable bool
	invalid     bool
}

func (engine *fakeEngine) Call(_ context.Context, _ *workerrpc.Meta, call workerrpc.ServiceCall) (workerrpc.ServiceResult, error) {
	if engine.unavailable {
		return workerrpc.ServiceResult{}, failure(workerrpc.KindUnavailable, "missing rules")
	}
	params := call.Params.(map[string]any)
	input := params["inputs"].(model.Inputs)
	result := evaluated{ContractVersion: "rules-character-response.v1", Identity: map[string]any{"rulesetId": "synthetic"}, Policy: map[string]any{}, Evaluation: model.Result{ContractVersion: model.ContractVersion, Inputs: input, Ready: !engine.invalid, Sheet: map[string]any{"notesLength": len(input.Notes)}, Evidence: []model.Evidence{}, Explanations: map[string]model.Explanation{}, Issues: []model.Issue{}}}
	if engine.inspect != nil {
		result.Evaluation.Issues = engine.inspect(input)
		result.Evaluation.Ready = len(result.Evaluation.Issues) == 0
	}
	return workerrpc.ServiceResult{ProviderAddonID: "synthetic-engine", ProviderContractVersion: "4.0.0", ProviderGeneration: engine.generation, Result: raw(result)}, nil
}
func fixture(t *testing.T) (*Coordinator, *memoryData, *fakeEngine, *workerrpc.Meta) {
	t.Helper()
	data := &memoryData{}
	engine := &fakeEngine{generation: "engine-one"}
	c := New(data, engine)
	c.now = func() time.Time { return time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC) }
	meta := &workerrpc.Meta{Actor: &workerrpc.Actor{ID: "player-one", Role: "player"}, Generation: "sheet-one"}
	return c, data, engine, meta
}
func invoke(t *testing.T, c *Coordinator, meta *workerrpc.Meta, method string, r Request) (Response, error) {
	t.Helper()
	r.ContractVersion = "character.v2"
	r.Key = "hero"
	value, err := c.HandleRPC(context.Background(), workerrpc.Request{Method: "service/" + Contract + "/" + method, Params: raw(r), Meta: meta})
	if err != nil {
		return Response{}, err
	}
	return value.(Response), nil
}
func review(t *testing.T, c *Coordinator, meta *workerrpc.Meta, r Request) Response {
	t.Helper()
	response, err := invoke(t, c, meta, "preview", r)
	if err != nil || response.Token == "" {
		t.Fatalf("preview: %+v %v", response, err)
	}
	return response
}

func TestReviewedCommitIsActorBoundAndRetrySafe(t *testing.T) {
	c, data, _, meta := fixture(t)
	input := model.Blank()
	input.Notes = "A new character"
	request := Request{Operation: "build", OperationID: "operation-one", Summary: "Create character", Inputs: &input}
	p := review(t, c, meta, request)
	commit := Request{Token: p.Token, OperationID: request.OperationID}
	other := *meta
	actor := *meta.Actor
	actor.ID = "other-player"
	other.Actor = &actor
	if _, err := invoke(t, c, &other, "commit", commit); err == nil {
		t.Fatal("another actor committed a preview")
	}
	saved, err := invoke(t, c, meta, "commit", commit)
	if err != nil || saved.Revision != 1 {
		t.Fatalf("commit: %+v %v", saved, err)
	}
	again, err := invoke(t, c, meta, "commit", commit)
	if err != nil || again.Revision != 1 || data.writes != 1 {
		t.Fatal("retry duplicated revision")
	}

}

func TestDMAmendmentRecordsNewAuthorityAndExpiryInvalidatesReview(t *testing.T) {
	c, data, _, meta := fixture(t)
	meta.Actor.Role = "dm"
	input := model.Blank()
	base := review(t, c, meta, Request{Operation: "build", OperationID: "amend-create", Summary: "Create", Inputs: &input})
	if _, err := invoke(t, c, meta, "commit", Request{OperationID: "amend-create", Token: base.Token}); err != nil {
		t.Fatal(err)
	}
	grant := model.Grant{ID: "forged", ActorID: "forged", GrantedAt: "forged", Name: "Blessing", Reason: "Quest", Active: true, EffectiveLevel: 1, Condition: "always", Effects: []model.Effect{{Target: "maxHp", Mode: "add", Value: 2}}, Waivers: []string{}}
	p := review(t, c, meta, Request{ExpectedRevision: 1, Operation: "grant", OperationID: "amend-grant", Summary: "Reward", Grant: &grant})
	if _, err := invoke(t, c, meta, "commit", Request{ExpectedRevision: 1, OperationID: "amend-grant", Token: p.Token}); err != nil {
		t.Fatal(err)
	}
	original := data.state.Inputs.Grants[0]
	grant = original
	grant.Reason = "Extend the reward"
	grant.Effects[0].Value = 3
	grant.ExpiresAt = c.now().Add(time.Minute).Format(time.RFC3339)
	p = review(t, c, meta, Request{ExpectedRevision: 2, Operation: "amend-grant", OperationID: "amend-reward", Summary: grant.Reason, Grant: &grant, GrantID: original.ID})
	if _, err := invoke(t, c, meta, "commit", Request{ExpectedRevision: 2, OperationID: "amend-reward", Token: p.Token}); err != nil {
		t.Fatal(err)
	}
	if len(data.state.Inputs.Grants) != 1 || !data.state.Inputs.Grants[0].Active || data.state.Inputs.Grants[0].ID != original.ID || data.state.Inputs.Grants[0].ActorID != meta.Actor.ID {
		t.Fatal("amendment lost original authority or reward")
	}
	input = data.state.Inputs
	p = review(t, c, meta, Request{ExpectedRevision: 3, Operation: "build", OperationID: "expiry-review", Summary: "Review before expiry", Inputs: &input})
	before := c.now()
	c.now = func() time.Time { return before.Add(2 * time.Minute) }
	if _, err := invoke(t, c, meta, "commit", Request{ExpectedRevision: 3, OperationID: "expiry-review", Token: p.Token}); err == nil {
		t.Fatal("committed review after a grant expired")
	}
	if data.writes != 3 {
		t.Fatal("expiry failure wrote a revision")
	}
}
func TestGenericEditsCannotForgeDMGrants(t *testing.T) {
	c, _, _, meta := fixture(t)
	input := model.Blank()
	input.Grants = []model.Grant{{ID: "forged", ActorID: "dm", Active: true}}
	for _, operation := range []string{"build", "inventory", "notes", "adopt-rules"} {
		if _, err := invoke(t, c, meta, "preview", Request{Operation: operation, OperationID: "forged-change", Summary: "Forged", Inputs: &input}); err == nil {
			t.Fatalf("%s permitted a forged DM grant", operation)
		}
	}
	if _, err := invoke(t, c, meta, "preview", Request{Operation: "grant", Grant: &input.Grants[0]}); err == nil {
		t.Fatal("player could grant")
	}
}
func TestDMGrantIsStampedByCoordinatorAndImportNeedsReauthorization(t *testing.T) {
	c, _, _, meta := fixture(t)
	meta.Actor.Role = "dm"
	meta.Actor.ID = "real-dm"
	grant := model.Grant{ID: "forged-id", ActorID: "forged-actor", Name: "Reward", Reason: "Quest completed", EffectiveLevel: 1, Condition: "always"}
	p := review(t, c, meta, Request{Operation: "grant", OperationID: "grant-request", Summary: "Quest reward", Grant: &grant})
	if got := p.Evaluation.Inputs.Grants[0]; got.ActorID != "real-dm" || got.ID != "grant-grant-request" || got.GrantedAt == "" {
		t.Fatalf("untrusted provenance persisted: %+v", got)
	}
	input := model.Blank()
	input.Grants = []model.Grant{grant}
	if _, err := invoke(t, c, meta, "preview", Request{Operation: "import", OperationID: "import-request", Summary: "Import", Inputs: &input}); err == nil {
		t.Fatal("import silently trusted grants")
	}
	p = review(t, c, meta, Request{Operation: "import", OperationID: "import-request", Summary: "Import", Inputs: &input, ReauthorizeGrants: true})
	if p.Evaluation.Inputs.Grants[0].ActorID != "real-dm" {
		t.Fatal("import retained claimed actor")
	}
}
func TestReviewRejectsConcurrentAndRulesChangesAndMissingProviders(t *testing.T) {
	c, data, engine, meta := fixture(t)
	input := model.Blank()
	p := review(t, c, meta, Request{Operation: "build", OperationID: "operation-one", Summary: "Create", Inputs: &input})
	request := Request{Token: p.Token, OperationID: "operation-one"}
	engine.generation = "engine-two"
	response, err := invoke(t, c, meta, "commit", request)
	if err != nil || response.Status != "rules-changed" || data.writes != 0 {
		t.Fatalf("stale rules accepted: %+v %v", response, err)
	}
	engine.generation = "engine-one"
	data.revision = 1
	concurrent := c.previews[p.Token].State
	concurrent.OperationID = "another-operation"
	data.state = &concurrent
	response, err = invoke(t, c, meta, "commit", request)
	if err != nil || response.Status != "conflict" || data.writes != 0 {
		t.Fatal("stale revision accepted")
	}
	data.revision = 0
	data.state = nil
	engine.unavailable = true
	response, err = invoke(t, c, meta, "load", Request{})
	if err != nil || response.Status != "unavailable" {
		t.Fatal("missing provider did not preserve read-only state")
	}
}
func TestHiddenCoreAndUnknownFieldsRejected(t *testing.T) {
	c, data, _, meta := fixture(t)
	data.forbidden = true
	if _, err := invoke(t, c, meta, "load", Request{}); err == nil {
		t.Fatal("hidden core exposed")
	}
	_, err := c.HandleRPC(context.Background(), workerrpc.Request{Method: "service/" + Contract + "/preview", Meta: meta, Params: json.RawMessage(`{"contractVersion":"character.v2","key":"hero","admin":true}`)})
	if err == nil {
		t.Fatal("unknown request accepted")
	}
}
func TestNewCharactersCannotForgePlayLedger(t *testing.T) {
	c, _, _, meta := fixture(t)
	for _, mutate := range []func(*model.Inputs){
		func(i *model.Inputs) { i.Play.Rolls = append(i.Play.Rolls, model.PlayRoll{ID: "claimed-roll"}) },
		func(i *model.Inputs) {
			i.Build.Spells.Acquisitions = append(i.Build.Spells.Acquisitions, model.SpellAcquisition{ID: "claimed-copy"})
		},
		func(i *model.Inputs) {
			i.Build.Spells.Swaps = append(i.Build.Spells.Swaps, model.SpellSwap{ClassID: "claimed-swap"})
		},
	} {
		input := model.Blank()
		mutate(&input)
		if _, err := invoke(t, c, meta, "preview", Request{Operation: "build", OperationID: "claimed-operation", Summary: "Create", Inputs: &input}); err == nil {
			t.Fatal("creation forged a play ledger")
		}
	}
}

func TestNotesRemainWritableWithoutRulesAndDoNotChangeProjection(t *testing.T) {
	c, data, engine, meta := fixture(t)
	p := review(t, c, meta, Request{Operation: "build", OperationID: "first-operation", Summary: "Create"})
	if _, err := invoke(t, c, meta, "commit", Request{Token: p.Token, OperationID: "first-operation"}); err != nil {
		t.Fatal(err)
	}
	projection := raw(data.state.Projection)
	input := data.state.Inputs
	input.Notes = "Offline session notes"
	engine.unavailable = true
	p = review(t, c, meta, Request{Operation: "notes", OperationID: "notes-operation", Summary: "Session notes", ExpectedRevision: 1, Inputs: &input})
	if _, err := invoke(t, c, meta, "commit", Request{Token: p.Token, OperationID: "notes-operation", ExpectedRevision: 1}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(projection, raw(data.state.Projection)) || data.state.Inputs.Notes != input.Notes {
		t.Fatal("offline notes changed mechanics or failed to save")
	}
	input.Play.HP++
	if _, err := invoke(t, c, meta, "preview", Request{Operation: "notes", ExpectedRevision: 2, Inputs: &input}); err == nil {
		t.Fatal("notes bypassed play validation")
	}
	c.previews = map[string]preview{}
	r, err := invoke(t, c, meta, "commit", Request{OperationID: "notes-operation", ExpectedRevision: 1})
	if err != nil || r.Revision != 2 || data.writes != 2 {
		t.Fatal("lost response retry duplicated an operation")
	}
}

func TestImportedGrantItemReferencesAreRemapped(t *testing.T) {
	c, _, _, meta := fixture(t)
	meta.Actor.Role = "dm"
	input := model.Blank()
	input.Grants = []model.Grant{{ID: "external-grant", Name: "Reward", Reason: "Imported reward", Active: true, ItemID: "reward-item"}}
	input.Play.Inventory = []model.Item{{ID: "reward-item", GrantID: "external-grant"}}
	next, err := c.propose(context.Background(), meta, Request{Operation: "import", OperationID: "import-operation", Inputs: &input, ReauthorizeGrants: true}, nil, model.Blank())
	if err != nil || next.Play.Inventory[0].GrantID != next.Grants[0].ID || next.Grants[0].ActorID != meta.Actor.ID {
		t.Fatalf("imported grant lost ownership: %+v %v", next, err)
	}
}

func TestAutosaveUsesCurrentStateAndRejectsHistory(t *testing.T) {
	c, data, engine, meta := fixture(t)
	input := model.Blank()
	request := Request{Operation: "build", OperationID: "automatic-save", Summary: "Update character", Inputs: &input}
	saved, err := invoke(t, c, meta, "save", request)
	if err != nil || saved.Revision != 1 || data.writes != 1 {
		t.Fatalf("save: %+v %v", saved, err)
	}
	again, err := invoke(t, c, meta, "save", request)
	if err != nil || again.Revision != 1 || data.writes != 1 {
		t.Fatal("retry repeated write", err)
	}
	for _, method := range []string{"history", "revision", "compare"} {
		if _, err := invoke(t, c, meta, method, Request{}); err == nil {
			t.Fatal("removed method remained callable", method)
		}
	}
	stale, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "stale-save", Summary: "Stale", Inputs: &input})
	if err != nil || stale.Status != "conflict" || data.writes != 1 {
		t.Fatal("stale save wrote", stale, err)
	}
	engine.invalid = true
	invalid, err := invoke(t, c, meta, "save", Request{Operation: "build", ExpectedRevision: 1, OperationID: "invalid-save", Summary: "Invalid", Inputs: &input})
	if err != nil || invalid.Status != "invalid" || data.writes != 1 {
		t.Fatal("invalid save wrote", invalid, err)
	}
	if _, err := invoke(t, c, meta, "save", Request{Operation: "restore", ExpectedRevision: 1, OperationID: "removed-restore", Summary: "Restore"}); err == nil {
		t.Fatal("restore remained available")
	}
}

func TestRetroactiveOriginEditWithdrawsOnlyPreviouslySavedChoices(t *testing.T) {
	c, data, engine, meta := fixture(t)
	input := model.Blank()
	input.Build.Species = "old-origin"
	input.Build.Choices = []model.Choice{{ID: "origin-choice", Value: json.RawMessage(`"old-option"`)}}
	saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "original-origin", Summary: "Origin", Inputs: &input})
	if err != nil || saved.Status != "ready" {
		t.Fatal(saved, err)
	}
	engine.inspect = func(input model.Inputs) []model.Issue {
		for _, choice := range input.Build.Choices {
			if choice.ID == "origin-choice" && input.Build.Species != "old-origin" {
				return []model.Issue{{ID: "unavailable-choice:origin-choice/0", Target: "origin-choice", Severity: "blocker"}}
			}
		}
		return nil
	}
	input.Build.Species = "new-origin"
	saved, err = invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "changed-origin", Summary: "Origin", Inputs: &input, ExpectedRevision: 1})
	if err != nil || saved.Status != "ready" || len(data.state.Inputs.Build.Choices) != 0 {
		t.Fatal("withdrawn choice blocked retroactive edit", saved, err)
	}
	input = data.state.Inputs
	input.Build.Choices = []model.Choice{{ID: "origin-choice", Value: json.RawMessage(`"forged-option"`)}}
	saved, err = invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "illegal-new-choice", Summary: "Origin", Inputs: &input, ExpectedRevision: 2})
	if err != nil || saved.Status != "invalid" || data.writes != 2 {
		t.Fatal("new illegal choice was silently accepted", saved, err)
	}
}
