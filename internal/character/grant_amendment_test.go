package character

import (
	"context"
	"reflect"
	"testing"

	model "github.com/pjunak/addon-dnd-engine/character"
)

func TestGrantAmendmentPreservesOrderAndClearsOnlyItsOldItemLinks(t *testing.T) {
	for _, operation := range []string{"move", "detach", "revoke"} {
		t.Run(operation, func(t *testing.T) {
			c, data, _, meta := fixture(t)
			meta.Actor.Role = "dm"
			input := model.Blank()
			input.Notes = "Keep authored notes"
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
			if !reflect.DeepEqual(next.Play.Inventory, expected) || next.Notes != input.Notes {
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
			added, err := invoke(t, c, meta, "save", Request{Operation: "grant", OperationID: "original-reward", Summary: "Reward", Grant: &grant})
			if err != nil || added.Status != "ready" {
				t.Fatal(added, err)
			}
			original := string(raw(added.State))
			grant.Name = "Rejected amendment"
			grant.Reason = "New reason"
			engine.invalid = !unavailable
			engine.unavailable = unavailable
			changed, err := invoke(t, c, meta, "save", Request{Operation: "amend-grant", OperationID: "rejected-amendment", Summary: "Amend", GrantID: added.State.Inputs.Grants[0].ID, Grant: &grant, ExpectedRevision: added.Revision})
			if err != nil || changed.Status != map[bool]string{false: "invalid", true: "unavailable"}[unavailable] {
				t.Fatal(changed, err)
			}
			if string(raw(changed.State)) != original || string(raw(data.state)) != original || data.writes != 1 {
				t.Fatal("a rejected amendment changed the snapshot returned as saved", changed, data.state)
			}
		})
	}
}
