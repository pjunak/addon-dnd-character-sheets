package character

import (
	model "github.com/pjunak/addon-dnd-engine/character"
	"reflect"
	"testing"
)

func TestGrantRepairKeepsValidSpellsAndRejectsNewInvalidInput(t *testing.T) {
	c, data, engine, meta := fixture(t)
	input := model.Blank()
	input.Build.Spells.GrantChoices = map[string][]string{"first": {"kept", "withdrawn"}, "second": {"other"}}
	input.Build.Spells.CastingAbilities = map[string]string{"first": "INT"}
	input.Play.ResourceUses = map[string]int{"first": 1, "second": 1}
	input.Play.ActiveFeatures = map[string]bool{"first": true}
	saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "spell-original", Summary: "Spells", Inputs: &input})
	if err != nil || saved.Status != "ready" {
		t.Fatal(saved, err)
	}
	engine.inspect = func(next model.Inputs) []model.Issue {
		if next.Build.Species != "new" {
			return nil
		}
		issues := []model.Issue{}
		for key, ids := range next.Build.Spells.GrantChoices {
			for _, id := range ids {
				if id != "kept" && key == "first" {
					issues = append(issues, model.Issue{ID: "spell-grant:" + key + ":" + id, Severity: "blocker"})
				}
			}
		}
		if next.Build.Spells.CastingAbilities["first"] != "" {
			issues = append(issues, model.Issue{ID: "casting-ability:first", Severity: "blocker"})
		}
		if next.Play.ResourceUses["first"] != 0 {
			issues = append(issues, model.Issue{ID: "resource:first", Severity: "blocker"})
		}
		if next.Play.ActiveFeatures["first"] {
			issues = append(issues, model.Issue{ID: "activation:first", Severity: "blocker"})
		}
		return issues
	}
	input.Build.Species = "new"
	saved, err = invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "spell-withdraw", Summary: "Origin", Inputs: &input, ExpectedRevision: 1})
	if err != nil || saved.Status != "ready" || !reflect.DeepEqual(data.state.Inputs.Build.Spells.GrantChoices, map[string][]string{"first": {"kept"}, "second": {"other"}}) || data.state.Inputs.Play.ResourceUses["second"] != 1 || data.state.Inputs.Play.ResourceUses["first"] != 0 || len(data.state.Inputs.Build.Spells.CastingAbilities) != 0 || len(data.state.Inputs.Play.ActiveFeatures) != 0 {
		t.Fatal(saved, err, data.state.Inputs)
	}
	input.Build.Spells.GrantChoices["first"] = []string{"new-illegal"}
	saved, err = invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "spell-illegal", Summary: "Spell", Inputs: &input, ExpectedRevision: 2})
	if err != nil || saved.Status != "invalid" || data.writes != 2 {
		t.Fatal("silently discarded new invalid spell", saved, err)
	}
}

func TestGrantRepairNeverAssignsAmbiguousAliasesOrResetsAvailableResource(t *testing.T) {
	input := model.Blank()
	input.Build.Spells.GrantChoices["old"] = []string{"saved"}
	input.Play.ResourceUses["old"] = 1
	before := raw(input)
	evaluation := model.Result{SpellOptions: map[string]any{"pendingChoices": []any{map[string]any{"key": "a", "legacyKey": "old"}, map[string]any{"key": "b", "legacyKey": "old"}}}, Sheet: map[string]any{"resources": []any{map[string]any{"key": "old", "max": 0}}}, Issues: []model.Issue{{ID: "spell-grant:old"}, {ID: "resource:old"}}}
	if repairGrantSelections(&input, input, evaluation) || string(before) != string(raw(input)) {
		t.Fatal("rewrote ambiguous or still-present state")
	}
}
