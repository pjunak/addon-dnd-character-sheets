package character

import (
	"encoding/json"
	"reflect"

	model "github.com/pjunak/addon-dnd-engine/character"
)

// Only selections present in the saved snapshot can be withdrawn automatically.
// Ambiguous historical aliases and newly supplied invalid values require repair.
func repairGrantSelections(input *model.Inputs, previous model.Inputs, evaluation model.Result) bool {
	issues := map[string]bool{}
	for _, issue := range evaluation.Issues {
		issues[issue.ID] = true
	}
	pending, aliases := grantDescriptors(evaluation.SpellOptions["pendingChoices"])
	changed := false
	for key, ids := range input.Build.Spells.GrantChoices {
		old, saved := previous.Build.Spells.GrantChoices[key]
		if !saved || !reflect.DeepEqual(ids, old) || aliases[key] {
			continue
		}
		choice, available := pending[key]
		if !available && issues["spell-grant:"+key] {
			delete(input.Build.Spells.GrantChoices, key)
			changed = true
			continue
		}
		kept := []string{}
		for _, id := range ids {
			if !issues["spell-grant:"+key+":"+id] {
				kept = append(kept, id)
			}
		}
		if count, ok := choice["choose"].(float64); ok && issues["spell-grant:"+key] && len(kept) > int(count) {
			kept = kept[:max(0, int(count))]
		}
		if len(kept) != len(ids) {
			input.Build.Spells.GrantChoices[key] = kept
			changed = true
		}
	}
	_, aliases = grantDescriptors(evaluation.SpellOptions["castingAbilityChoices"])
	for key, value := range input.Build.Spells.CastingAbilities {
		old, saved := previous.Build.Spells.CastingAbilities[key]
		if saved && value == old && !aliases[key] && issues["casting-ability:"+key] {
			delete(input.Build.Spells.CastingAbilities, key)
			changed = true
		}
	}
	resources, aliases := grantDescriptors(evaluation.Sheet["resources"])
	for key, value := range input.Play.ResourceUses {
		old, saved := previous.Play.ResourceUses[key]
		if _, exists := resources[key]; !exists && saved && value == old && !aliases[key] && issues["resource:"+key] {
			delete(input.Play.ResourceUses, key)
			changed = true
		}
	}
	activations, aliases := grantDescriptors(evaluation.Sheet["activations"])
	for key, value := range input.Play.ActiveFeatures {
		old, saved := previous.Play.ActiveFeatures[key]
		if _, exists := activations[key]; !exists && saved && value == old && !aliases[key] && issues["activation:"+key] {
			delete(input.Play.ActiveFeatures, key)
			changed = true
		}
	}
	return changed
}

func grantDescriptors(value any) (map[string]map[string]any, map[string]bool) {
	var rows []map[string]any
	_ = json.Unmarshal(raw(value), &rows)
	indexed, aliases := map[string]map[string]any{}, map[string]bool{}
	for _, row := range rows {
		key, _ := row["key"].(string)
		indexed[key] = row
		alias, _ := row["legacyKey"].(string)
		if alias != "" && alias != key {
			aliases[alias] = true
		}
	}
	return indexed, aliases
}
