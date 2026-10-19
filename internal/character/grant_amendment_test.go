package character

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	model "github.com/pjunak/addon-dnd-engine/character"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

func TestGrantAmendmentPreservesOrderAndClearsOnlyItsOldItemLinks(t *testing.T) {
	for _, operation := range []string{"move", "detach", "revoke"} {
		t.Run(operation, func(t *testing.T) {
			c, data, _, meta := fixture(t)
			meta.Actor.Role = "dm"
			input := model.Blank()
			input.Play.Currency = map[string]float64{"gp": 12}
			input.Grants = []model.Grant{
				{ID: "first", Name: "First", ActorID: "dm", Reason: "Quest", Active: true, EffectiveLevel: 1, Condition: "always", ItemID: "old", Effects: []model.Effect{{Target: "initiative", Mode: "add", Value: 1}}},
				{ID: "second", Name: "Second", ActorID: "dm", Reason: "Study", Active: true, EffectiveLevel: 1, Condition: "always", ItemID: "other"},
			}
			input.Play.Inventory = []model.Item{
				{ID: "old", Name: "Old charm", GrantID: "first", Location: "carried", Quantity: 1, Notes: "Keep notes"},
				{ID: "new", Name: "New charm", Location: "carried", Quantity: 2},
				{ID: "other", Name: "Other charm", GrantID: "second", Location: "carried", Quantity: 1},
			}
			data.state = &State{Inputs: input}
			data.revision = 1
			grant := input.Grants[0]
			grant.Reason = "Amended reward"
			grant.ItemID = ""
			if operation == "move" {
				grant.ItemID = "new"
			}
			request := Request{Operation: "amend-grant", OperationID: "amend-first", GrantID: grant.ID, Grant: &grant, Inputs: &input}
			if operation == "revoke" {
				request.Operation = "revoke-grant"
			}
			before := string(raw(input))
			next, err := c.propose(context.Background(), meta, request, data.state, input)
			if err != nil {
				t.Fatal(err)
			}
			if string(raw(input)) != before {
				t.Fatal("proposal mutated the saved or request inputs")
			}
			if next.Play.Inventory[0].GrantID != "" {
				t.Fatal("obsolete item authority remains", next.Play.Inventory)
			}
			wantNew := ""
			if operation == "move" {
				wantNew = "first"
			}
			if next.Play.Inventory[1].GrantID != wantNew || next.Play.Inventory[2].GrantID != "second" {
				t.Fatal("wrong item ownership", next.Play.Inventory)
			}
			expected := input.Play.Inventory
			expected = append([]model.Item(nil), expected...)
			expected[0].GrantID = ""
			expected[1].GrantID = wantNew
			if !reflect.DeepEqual(next.Play.Inventory, expected) || next.Play.Currency["gp"] != input.Play.Currency["gp"] {
				t.Fatal("unrelated authored input changed")
			}
			if operation == "revoke" {
				if len(next.Grants) != 1 || !reflect.DeepEqual(next.Grants[0], input.Grants[1]) {
					t.Fatal("revoke changed a sibling grant", next.Grants)
				}
			} else {
				if len(next.Grants) != 2 || next.Grants[0].ID != "first" || !reflect.DeepEqual(next.Grants[1], input.Grants[1]) {
					t.Fatal("amendment reordered or changed other grants", next.Grants)
				}
				if next.Grants[0].ActorID != meta.Actor.ID || next.Grants[0].Reason != grant.Reason {
					t.Fatal("amendment lost current authority")
				}
			}
		})
	}
}

func TestRejectedGrantAmendmentReturnsTheUnchangedSavedSnapshot(t *testing.T) {
	for _, unavailable := range []bool{false, true} {
		t.Run(map[bool]string{false: "invalid", true: "unavailable"}[unavailable], func(t *testing.T) {
			c, data, engine, meta := fixture(t)
			meta.Actor.Role = "dm"
			grant := model.Grant{Name: "Original", Reason: "Quest", Condition: "always", EffectiveLevel: 1}
			added, err := invoke(t, c, meta, "save", Request{Operation: "grant", OperationID: "original-reward", Grant: &grant})
			if err != nil || added.Status != "ready" {
				t.Fatal(added, err)
			}
			original := string(raw(added.State))
			grant.Name = "Rejected amendment"
			grant.Reason = "New reason"
			engine.invalid = !unavailable
			engine.unavailable = unavailable
			changed, err := invoke(t, c, meta, "save", Request{Operation: "amend-grant", OperationID: "rejected-amendment", GrantID: added.State.Inputs.Grants[0].ID, Grant: &grant, ExpectedRevision: added.Revision})
			if err != nil || changed.Status != map[bool]string{false: "invalid", true: "unavailable"}[unavailable] {
				t.Fatal(changed, err)
			}
			if string(raw(changed.State)) != original || string(raw(data.state)) != original || data.writes != 1 {
				t.Fatal("a rejected amendment changed the snapshot returned as saved", changed, data.state)
			}
		})
	}
}

// changedRulesFixture saves a DM grant whose feat, and the choice that feat
// offers, exist only under the current rules. Under the revised rules
// (engine-two) the grant blocks saving and the choice is no longer granted.
func changedRulesFixture(t *testing.T) (*Coordinator, *memoryData, *fakeEngine, *workerrpc.Meta, model.Inputs) {
	t.Helper()
	c, data, engine, meta := fixture(t)
	meta.Actor.Role = "dm"
	grant := model.Grant{Name: "Old training", Reason: "Quest", Condition: "always", EffectiveLevel: 1, Feat: &model.Reference{Kind: "feat", ID: "retired-feat"}, Effects: []model.Effect{}, Waivers: []string{}}
	added, err := invoke(t, c, meta, "save", Request{Operation: "grant", OperationID: "retired-reward", Grant: &grant})
	if err != nil || added.Status != "ready" {
		t.Fatal(added, err)
	}
	input := added.State.Inputs
	input.Build.Choices = []model.Choice{{ID: "retired-choice", Value: raw("old-pick")}}
	if saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "retired-pick", Inputs: &input, ExpectedRevision: added.Revision}); err != nil || saved.Status != "ready" {
		t.Fatal(saved, err)
	}
	engine.inspect = func(input model.Inputs) []model.Issue {
		if engine.generation != "engine-two" {
			return nil
		}
		issues, granted := []model.Issue{}, false
		for _, grant := range input.Grants {
			if grant.Feat != nil && grant.Feat.ID == "retired-feat" {
				granted = true
				issues = append(issues, model.Issue{ID: "grant-feat:" + grant.ID, Target: "grants", Severity: "blocker"})
			}
		}
		for _, choice := range input.Build.Choices {
			if choice.ID == "retired-choice" && !granted {
				issues = append(issues, model.Issue{ID: "unavailable-choice:retired-choice#0", Target: "retired-choice", Severity: "blocker"})
			}
		}
		return issues
	}
	engine.generation = "engine-two"
	return c, data, engine, meta, cloneInputs(data.state.Inputs)
}

func TestDMRepairsAGrantTheChangedRulesRejectBeforeAdoptingThem(t *testing.T) {
	for _, change := range []string{"revoke", "amend"} {
		t.Run(change, func(t *testing.T) {
			c, data, _, meta, saved := changedRulesFixture(t)
			if refused, err := invoke(t, c, meta, "save", Request{Operation: "adopt-rules", OperationID: "adopt-with-grant", AdoptRules: true, Inputs: &saved, ExpectedRevision: 2}); err != nil || refused.Status != "invalid" || data.writes != 2 {
				t.Fatal("the grant did not block adoption", refused.Status, err)
			}
			// The change waits with the other pending edits, like any edit
			// under changed rules, and the adoption saves it.
			pending := cloneInputs(saved)
			pending.Play.Currency = map[string]float64{"gp": 3}
			if change == "revoke" {
				pending.Grants = []model.Grant{}
			} else {
				pending.Grants[0].Feat = &model.Reference{Kind: "feat", ID: "current-feat"}
				pending.Grants[0].Reason = "Retrained under the new sources"
			}
			waiting, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "pending-" + change, Inputs: &pending, ExpectedRevision: 2})
			if err != nil || waiting.Status != "rules-changed" || data.writes != 2 {
				t.Fatal("the grant change did not wait for adoption", waiting.Status, waiting.Message, err)
			}
			adopted, err := invoke(t, c, meta, "save", Request{Operation: "adopt-rules", OperationID: "adopt-after-" + change, AdoptRules: true, Inputs: &pending, ExpectedRevision: 2})
			if err != nil || adopted.Status != "ready" || adopted.RulesChanged || data.writes != 3 {
				t.Fatal("adoption did not save the grant change", adopted.Status, adopted.Message, err)
			}
			got := data.state.Inputs
			if got.Play.Currency["gp"] != 3 || len(got.Build.Choices) != 0 || data.state.Rules.EngineGeneration != "engine-two" {
				t.Fatal("adoption lost an edit or kept the withdrawn choice", got.Play.Currency, got.Build.Choices)
			}
			// Only the previously saved choice is withdrawn.
			if want := []Difference{{Path: "/inputs/build/choices/retired-choice", Before: "old-pick"}}; !reflect.DeepEqual(adopted.Withdrawn, want) {
				t.Fatalf("withdrawn = %+v", adopted.Withdrawn)
			}
			if change == "revoke" && len(got.Grants) != 0 {
				t.Fatal("the revoked grant was kept", got.Grants)
			}
			if change == "amend" {
				amended := got.Grants[0]
				if len(got.Grants) != 1 || amended.ID != saved.Grants[0].ID || amended.Feat.ID != "current-feat" || amended.ActorID != meta.Actor.ID || amended.GrantedAt != c.now().UTC().Format(time.RFC3339) || !amended.Active {
					t.Fatal("the amendment was not recorded like amend-grant", got.Grants)
				}
			}
		})
	}
}

func TestPendingEditsCarryOnlyDMRevocationsAndAmendmentsWhileRulesChanged(t *testing.T) {
	refused := func(t *testing.T, c *Coordinator, data *memoryData, meta *workerrpc.Meta, inputs model.Inputs, kind, message string) {
		t.Helper()
		_, err := invoke(t, c, meta, "save", Request{Operation: "adopt-rules", OperationID: "carried-grants", AdoptRules: true, Inputs: &inputs, ExpectedRevision: 2})
		var failure *workerrpc.RPCError
		if !errors.As(err, &failure) || failure.Data == nil || failure.Data.Kind != kind || failure.Data.Message != message || data.writes != 2 {
			t.Fatalf("answered %v, want %s %q", err, kind, message)
		}
	}
	t.Run("new grant", func(t *testing.T) {
		c, data, _, meta, saved := changedRulesFixture(t)
		saved.Grants = append(saved.Grants, model.Grant{ID: "extra", Name: "Extra", Reason: "Bonus", Active: true, Condition: "always", EffectiveLevel: 1})
		refused(t, c, data, meta, saved, workerrpc.KindUnauthorized, "DM grants require a DM grant command.")
	})
	t.Run("amendment without a reason", func(t *testing.T) {
		c, data, _, meta, saved := changedRulesFixture(t)
		saved.Grants[0].Reason = " "
		refused(t, c, data, meta, saved, workerrpc.KindInvalidRequest, "Explain why this DM grant was given.")
	})
	t.Run("player", func(t *testing.T) {
		c, data, _, meta, saved := changedRulesFixture(t)
		meta.Actor.Role = "player"
		saved.Grants = []model.Grant{}
		refused(t, c, data, meta, saved, workerrpc.KindUnauthorized, "DM grants require a DM grant command.")
	})
	t.Run("current rules", func(t *testing.T) {
		c, data, engine, meta, saved := changedRulesFixture(t)
		engine.generation = "engine-one"
		saved.Grants = []model.Grant{}
		refused(t, c, data, meta, saved, workerrpc.KindUnauthorized, "DM grants require a DM grant command.")
	})
}
