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
	history   []workerrpc.AddonHistoryEntry
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
func (data *memoryData) History(context.Context, *workerrpc.Meta, workerrpc.AddonDataReference, string, int64, int) (workerrpc.AddonHistoryResult, error) {
	if data.forbidden {
		return workerrpc.AddonHistoryResult{}, failure(workerrpc.KindUnauthorized, "hidden character")
	}
	return workerrpc.AddonHistoryResult{Entries: data.history}, nil
}
func (data *memoryData) Revision(_ context.Context, _ *workerrpc.Meta, _ workerrpc.AddonDataReference, _ string, revision int64) (workerrpc.AddonHistoryEntry, error) {
	if data.forbidden {
		return workerrpc.AddonHistoryEntry{}, failure(workerrpc.KindUnauthorized, "hidden character")
	}
	for _, entry := range data.history {
		if entry.Revision == revision {
			return entry, nil
		}
	}
	return workerrpc.AddonHistoryEntry{}, failure(workerrpc.KindNotFound, "missing")
}
func (data *memoryData) TransactRecorded(_ context.Context, meta *workerrpc.Meta, mutations []workerrpc.AddonDataMutation, operation workerrpc.RecordedOperation) (workerrpc.AddonDataCommit, error) {
	m := mutations[0]
	if m.ExpectedRevision != data.revision {
		return workerrpc.AddonDataCommit{}, failure(workerrpc.KindConflict, "changed")
	}
	state := m.Value.(State)
	data.state = &state
	data.revision++
	data.writes++
	data.history = append(data.history, workerrpc.AddonHistoryEntry{Revision: data.revision, ActorID: meta.Actor.ID, Operation: operation.Operation, OperationID: operation.ID, Value: raw(state)})
	return workerrpc.AddonDataCommit{Results: []workerrpc.AddonDataMutationResult{{AfterRevision: data.revision}}}, nil
}

type fakeEngine struct {
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
	r.ContractVersion = "character.v1"
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
	if data.history[0].ActorID != "player-one" || data.history[0].Operation != "character.build" {
		t.Fatal("missing authoritative provenance")
	}
}

func TestHistoricalComparisonIsReadOnlyAndWorksWithoutRules(t *testing.T) {
	c, data, engine, meta := fixture(t)
	input := model.Blank()
	for index, notes := range []string{"Before", "After"} {
		input.Notes = notes
		r := Request{ExpectedRevision: int64(index), Operation: "build", OperationID: "compare-" + notes, Summary: notes, Inputs: &input}
		p := review(t, c, meta, r)
		if _, err := invoke(t, c, meta, "commit", Request{ExpectedRevision: int64(index), OperationID: r.OperationID, Token: p.Token}); err != nil {
			t.Fatal(err)
		}
	}
	engine.unavailable = true
	compared, err := invoke(t, c, meta, "compare", Request{Revision: 1, CompareRevision: 2})
	if err != nil || compared.State.Inputs.Notes != "After" || data.writes != 2 {
		t.Fatalf("comparison: %+v %v", compared, err)
	}
	found := false
	for _, change := range compared.Changes {
		found = found || change.Path == "/inputs/notes" && change.Before == "Before" && change.After == "After"
	}
	if !found {
		t.Fatal("missing semantic difference")
	}
	data.forbidden = true
	if _, err := invoke(t, c, meta, "compare", Request{Revision: 1, CompareRevision: 2}); err == nil {
		t.Fatal("hidden history was accessible")
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
	if len(data.state.Inputs.Grants) != 2 || data.state.Inputs.Grants[0].Active || data.state.Inputs.Grants[1].ID == original.ID || data.state.Inputs.Grants[1].ActorID != meta.Actor.ID {
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
	_, err := c.HandleRPC(context.Background(), workerrpc.Request{Method: "service/" + Contract + "/preview", Meta: meta, Params: json.RawMessage(`{"contractVersion":"character.v1","key":"hero","admin":true}`)})
	if err == nil {
		t.Fatal("unknown request accepted")
	}
}
func TestRestoreAppendsWithoutRewritingHistory(t *testing.T) {
	c, data, _, meta := fixture(t)
	input := model.Blank()
	input.Notes = "first"
	p := review(t, c, meta, Request{Operation: "build", OperationID: "operation-one", Summary: "First", Inputs: &input})
	_, err := invoke(t, c, meta, "commit", Request{Token: p.Token, OperationID: "operation-one"})
	if err != nil {
		t.Fatal(err)
	}
	first := append([]byte(nil), data.history[0].Value...)
	input = data.state.Inputs
	input.Notes = "second"
	p = review(t, c, meta, Request{Operation: "notes", OperationID: "operation-two", Summary: "Second", Inputs: &input, ExpectedRevision: 1})
	_, err = invoke(t, c, meta, "commit", Request{Token: p.Token, OperationID: "operation-two", ExpectedRevision: 1})
	if err != nil {
		t.Fatal(err)
	}
	p = review(t, c, meta, Request{Operation: "restore", RestoreScope: "complete", OperationID: "operation-restore", Summary: "Restore first", Revision: 1, ExpectedRevision: 2})
	_, err = invoke(t, c, meta, "commit", Request{Token: p.Token, OperationID: "operation-restore", ExpectedRevision: 2})
	if err != nil {
		t.Fatal(err)
	}
	if data.revision != 3 || data.state.Inputs.Notes != "first" || !reflect.DeepEqual(first, []byte(data.history[0].Value)) {
		t.Fatal("restore rewrote history")
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

func TestRestoreDefaultsToBuildAndPreservesCurrentPlay(t *testing.T) {
	c, data, _, meta := fixture(t)
	old := State{SchemaVersion: SchemaVersion, Inputs: model.Blank()}
	old.Inputs.Build.Species = "previous-species"
	old.Inputs.Play.HP = 5
	old.Inputs.Notes = "old notes"
	data.history = []workerrpc.AddonHistoryEntry{{Revision: 1, Value: raw(old)}}
	current := State{SchemaVersion: SchemaVersion, Inputs: model.Blank()}
	current.Inputs.Build.Species = "current-species"
	current.Inputs.Play.HP = 2
	current.Inputs.Notes = "current notes"
	current.Inputs.Play.Inventory = []model.Item{{ID: "bought-item", Name: "Rope", Quantity: 1}}
	current.Inputs.Build.Spells.Acquisitions = []model.SpellAcquisition{{ID: "copied-afterward", ClassID: "mage", SpellID: "paid-copy"}}
	next, err := c.propose(context.Background(), meta, Request{Operation: "restore", Key: "hero", Revision: 1}, &current, current.Inputs)
	if err != nil || next.Build.Species != "previous-species" || !reflect.DeepEqual(next.Play, current.Inputs.Play) || next.Notes != "current notes" {
		t.Fatalf("build restore rewound play: %+v %v", next, err)
	}
	if len(next.Build.Spells.Acquisitions) != 1 || !reflect.DeepEqual(next.Build.Spells.Spellbook["mage"], []string{"paid-copy"}) {
		t.Fatal("build restoration erased a paid spell acquisition")
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
