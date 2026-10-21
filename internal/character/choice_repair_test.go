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
			saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "original-training", Inputs: &input})
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
			saved, err = invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "changed-training", Inputs: &input, ExpectedRevision: 1})
			if err != nil || saved.Status != "ready" || !reflect.DeepEqual(data.state.Inputs.Build.Choices, input.Build.Choices[:1]) {
				t.Fatal("repair lost a valid sibling slot or retained an unavailable slot", saved, data.state.Inputs.Build.Choices, err)
			}
			if len(input.Build.Choices) != 2 {
				t.Fatal("repair mutated the supplied request")
			}
			input.Build.Choices[1].Value = raw("new-illegal-option")
			saved, err = invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "illegal-training", Inputs: &input, ExpectedRevision: 2})
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
			added, err := invoke(t, c, meta, "save", Request{Operation: "grant", OperationID: "training-reward", Grant: &grant})
			if err != nil || added.Status != "ready" {
				t.Fatal(added, err)
			}
			input := added.State.Inputs
			input.Play.Currency = map[string]float64{"gp": 8}
			input.Build.Choices = []model.Choice{{ID: "origin-training", Value: raw("kept")}, {ID: "reward-training", Value: raw("withdrawn")}}
			saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "training-selections", Inputs: &input, ExpectedRevision: 1})
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
			changed, err := invoke(t, c, meta, "save", Request{Operation: operation, OperationID: "changed-reward", GrantID: added.State.Inputs.Grants[0].ID, Grant: &grant, ExpectedRevision: 2})
			if err != nil || changed.Status != "ready" || data.writes != 3 || !reflect.DeepEqual(data.state.Inputs.Build.Choices, input.Build.Choices[:1]) || data.state.Inputs.Play.Currency["gp"] != input.Play.Currency["gp"] {
				t.Fatal("grant change lost unrelated input or could not withdraw its own choices", changed, err)
			}
		})
	}
}

func TestAdoptingRulesWithdrawsSavedChoicesTheNewRulesNoLongerGrant(t *testing.T) {
	c, data, engine, meta := fixture(t)
	// Under the revised rules (engine-two) the bonus feat, which added 5
	// maximum HP, is no longer granted.
	feats := func(input model.Inputs) []model.Choice {
		chosen := []model.Choice{}
		for _, choice := range input.Build.Choices {
			if choice.ID == "bonus-feat" {
				chosen = append(chosen, choice)
			}
		}
		return chosen
	}
	maximum := func(input model.Inputs) int { return 10 + 5*len(feats(input)) }
	engine.derived = maximum
	engine.inspect = func(input model.Inputs) []model.Issue {
		issues := []model.Issue{}
		if engine.generation == "engine-two" {
			for _, choice := range feats(input) {
				issues = append(issues, model.Issue{ID: fmt.Sprintf("unavailable-choice:bonus-feat#%d", choice.Slot), Target: "bonus-feat", Severity: "blocker"})
			}
		}
		if input.Play.HP > maximum(input) {
			issues = append(issues, model.Issue{ID: "hp", Target: "hp", Severity: "blocker"})
		}
		return issues
	}
	input := model.Blank()
	input.Build.Choices = []model.Choice{{ID: "bonus-feat", Value: raw("tough")}}
	input.Play.HP = 15
	saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "original-feat", Inputs: &input})
	if err != nil || saved.Status != "ready" || len(saved.Withdrawn) != 0 {
		t.Fatal(saved, err)
	}
	engine.generation = "engine-two"
	if loaded, err := invoke(t, c, meta, "load", Request{}); err != nil || !loaded.RulesChanged {
		t.Fatal("the revised rules were not reported", loaded, err)
	}
	// A selection supplied with the adoption is not withdrawn for the user.
	pending := cloneInputs(input)
	pending.Build.Choices = append(pending.Build.Choices, model.Choice{ID: "bonus-feat", Slot: 1, Value: raw("tough")})
	refused, err := invoke(t, c, meta, "save", Request{Operation: "adopt-rules", OperationID: "adopt-with-new-feat", AdoptRules: true, Inputs: &pending, ExpectedRevision: saved.Revision})
	if err != nil || refused.Status != "invalid" || data.writes != 1 {
		t.Fatal("adoption silently withdrew a new selection", refused, err)
	}
	adopted, err := invoke(t, c, meta, "save", Request{Operation: "adopt-rules", OperationID: "adopt-revised-rules", AdoptRules: true, Inputs: &input, ExpectedRevision: saved.Revision})
	if err != nil || adopted.Status != "ready" || adopted.RulesChanged || data.writes != 2 {
		t.Fatal("a withdrawn choice blocked adopting the rules", adopted, err)
	}
	if got := data.state; len(got.Inputs.Build.Choices) != 0 || got.Inputs.Play.HP != 10 || got.Rules.EngineGeneration != "engine-two" {
		t.Fatal("adoption kept the withdrawn choice or its hit points", got.Inputs.Build.Choices, got.Inputs.Play.HP, got.Rules)
	}
	if want := []Difference{{Path: "/inputs/build/choices/bonus-feat", Before: "tough"}}; !reflect.DeepEqual(adopted.Withdrawn, want) {
		t.Fatalf("withdrawn = %+v, want %+v", adopted.Withdrawn, want)
	}
}

func TestEarlierEditRepairsTheFullWithdrawnDependencyChain(t *testing.T) {
	c, data, engine, meta := fixture(t)
	input := model.Blank()
	input.Build.Species = "old-origin"
	for index := 0; index < 6; index++ {
		input.Build.Choices = append(input.Build.Choices, model.Choice{ID: fmt.Sprintf("grant-%d", index), Value: raw("selection")})
	}
	if saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "original-chain", Inputs: &input}); err != nil || saved.Status != "ready" {
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
	saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "changed-chain", Inputs: &input, ExpectedRevision: 1})
	if err != nil || saved.Status != "ready" || len(data.state.Inputs.Build.Choices) != 0 || data.writes != 2 {
		t.Fatal("dependent withdrawals were only partly repaired", saved, err)
	}
}
