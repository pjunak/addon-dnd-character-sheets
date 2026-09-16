package character

import (
	"fmt"
	"reflect"
	"testing"

	model "github.com/pjunak/addon-dnd-engine/character"
)

func TestEarlierEditPreservesUnaffectedChoiceSlots(t *testing.T) {
	for _, issueKind := range []string{"invalid-option:", "choice-count:"} {
		t.Run(issueKind, func(t *testing.T) {
			c, data, engine, meta := fixture(t)
			input := model.Blank()
			input.Build.Species = "old-origin"
			input.Build.Choices = []model.Choice{{ID: "training", Slot: 0, Value: raw("retained")}, {ID: "training", Slot: 1, Value: raw("withdrawn")}}
			saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "original-training", Summary: "Training", Inputs: &input})
			if err != nil || saved.Status != "ready" {
				t.Fatal(saved, err)
			}
			engine.inspect = func(input model.Inputs) []model.Issue {
				for _, choice := range input.Build.Choices {
					if input.Build.Species == "new-origin" && choice.Slot == 1 {
						return []model.Issue{{ID: issueKind + "training#1", Target: "training", Severity: "blocker"}}
					}
				}
				return nil
			}
			input.Build.Species = "new-origin"
			saved, err = invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "changed-training", Summary: "Origin", Inputs: &input, ExpectedRevision: 1})
			if err != nil || saved.Status != "ready" || !reflect.DeepEqual(data.state.Inputs.Build.Choices, input.Build.Choices[:1]) {
				t.Fatal("repair lost a valid sibling slot or retained an unavailable slot", saved, data.state.Inputs.Build.Choices, err)
			}
			if len(input.Build.Choices) != 2 {
				t.Fatal("repair mutated the supplied request")
			}
			input.Build.Choices[1].Value = raw("new-illegal-option")
			saved, err = invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "illegal-training", Summary: "Training", Inputs: &input, ExpectedRevision: 2})
			if err != nil || saved.Status != "invalid" || data.writes != 2 {
				t.Fatal("repair accepted a newly invalid slot", saved, err)
			}
		})
	}
}

func TestDMGrantChangesWithdrawOnlyTheirSavedChoices(t *testing.T) {
	for _, operation := range []string{"amend-grant", "revoke-grant"} {
		t.Run(operation, func(t *testing.T) {
			c, data, engine, meta := fixture(t)
			meta.Actor.Role = "dm"
			grant := model.Grant{Name: "Training", Reason: "Study", Condition: "always", EffectiveLevel: 1, Feat: &model.Reference{Kind: "feat", ID: "training"}}
			added, err := invoke(t, c, meta, "save", Request{Operation: "grant", OperationID: "training-reward", Summary: "Training", Grant: &grant})
			if err != nil || added.Status != "ready" {
				t.Fatal(added, err)
			}
			input := added.State.Inputs
			input.Notes = "Preserve these notes"
			input.Build.Choices = []model.Choice{{ID: "origin-training", Value: raw("kept")}, {ID: "reward-training", Value: raw("withdrawn")}}
			saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "training-selections", Summary: "Choices", Inputs: &input, ExpectedRevision: 1})
			if err != nil || saved.Status != "ready" {
				t.Fatal(saved, err)
			}
			engine.inspect = func(input model.Inputs) []model.Issue {
				available := len(input.Grants) > 0 && input.Grants[0].Feat != nil && input.Grants[0].Feat.ID == "training"
				for _, choice := range input.Build.Choices {
					if !available && choice.ID == "reward-training" {
						return []model.Issue{{ID: "unavailable-choice:reward-training#0", Target: "reward-training", Severity: "blocker"}}
					}
				}
				return nil
			}
			grant.Feat = &model.Reference{Kind: "feat", ID: "replacement"}
			changed, err := invoke(t, c, meta, "save", Request{Operation: operation, OperationID: "changed-reward", Summary: "Change reward", GrantID: added.State.Inputs.Grants[0].ID, Grant: &grant, ExpectedRevision: 2})
			if err != nil || changed.Status != "ready" || data.writes != 3 || !reflect.DeepEqual(data.state.Inputs.Build.Choices, input.Build.Choices[:1]) || data.state.Inputs.Notes != input.Notes {
				t.Fatal("grant change lost unrelated input or could not withdraw its own choices", changed, err)
			}
		})
	}
}

func TestEarlierEditRepairsTheFullWithdrawnDependencyChain(t *testing.T) {
	c, data, engine, meta := fixture(t)
	input := model.Blank()
	input.Build.Species = "old-origin"
	for index := 0; index < 6; index++ {
		input.Build.Choices = append(input.Build.Choices, model.Choice{ID: fmt.Sprintf("grant-%d", index), Value: raw("selection")})
	}
	if saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "original-chain", Summary: "Grants", Inputs: &input}); err != nil || saved.Status != "ready" {
		t.Fatal(saved, err)
	}
	engine.inspect = func(input model.Inputs) []model.Issue {
		if input.Build.Species == "new-origin" && len(input.Build.Choices) > 0 {
			id := input.Build.Choices[0].ID
			return []model.Issue{{ID: "unavailable-choice:" + id + "#0", Target: id, Severity: "blocker"}}
		}
		return nil
	}
	input.Build.Species = "new-origin"
	saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "changed-chain", Summary: "Origin", Inputs: &input, ExpectedRevision: 1})
	if err != nil || saved.Status != "ready" || len(data.state.Inputs.Build.Choices) != 0 || data.writes != 2 {
		t.Fatal("dependent withdrawals were only partly repaired", saved, err)
	}
}
