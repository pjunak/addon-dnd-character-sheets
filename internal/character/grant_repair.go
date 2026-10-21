package character

import (
	"reflect"

	model "github.com/pjunak/addon-dnd-engine/character"
)

// Only selections present in the saved snapshot can be withdrawn automatically.
// Newly supplied invalid values require repair.
func repairGrantSelections(input *model.Inputs, previous model.Inputs, evaluation model.Result) bool {
	issues := map[string]bool{}
	for _, issue := range evaluation.Issues {
		issues[issue.ID] = true
	}
	pending := map[string]model.SpellChoiceOptions{}
	for _, choice := range evaluation.SpellOptions.PendingChoices {
		pending[choice.Key] = choice
	}
	changed := false
	for key, ids := range input.Build.Spells.GrantChoices {
		old, saved := previous.Build.Spells.GrantChoices[key]
		if !saved || !reflect.DeepEqual(ids, old) {
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
		if available && issues["spell-grant:"+key] && len(kept) > choice.Choose {
			kept = kept[:max(0, choice.Choose)]
		}
		if len(kept) != len(ids) {
			input.Build.Spells.GrantChoices[key] = kept
			changed = true
		}
	}
	for key, value := range input.Build.Spells.CastingAbilities {
		old, saved := previous.Build.Spells.CastingAbilities[key]
		if saved && value == old && issues["casting-ability:"+key] {
			delete(input.Build.Spells.CastingAbilities, key)
			changed = true
		}
	}
	// A removed class level can leave a subclass or class spell list behind;
	// the Engine names exactly those.
	for classID, subclass := range input.Build.Subclasses {
		if old, saved := previous.Build.Subclasses[classID]; saved && subclass == old && issues["subclass-level:"+classID] {
			delete(input.Build.Subclasses, classID)
			changed = true
		}
	}
	for _, list := range []struct {
		name     string
		current  map[string][]string
		previous map[string][]string
	}{
		{"cantrips", input.Build.Spells.Cantrips, previous.Build.Spells.Cantrips},
		{"spellbook", input.Build.Spells.Spellbook, previous.Build.Spells.Spellbook},
		{"prepared", input.Play.PreparedSpells, previous.Play.PreparedSpells},
	} {
		for classID, ids := range list.current {
			if old, saved := list.previous[classID]; saved && reflect.DeepEqual(ids, old) && issues["spell-class:"+list.name+":"+classID] {
				delete(list.current, classID)
				changed = true
			}
		}
	}
	resources, activations := map[string]bool{}, map[string]bool{}
	if sheet := evaluation.Sheet.Calculation; sheet != nil {
		for _, resource := range sheet.Resources {
			resources[resource.Key] = true
		}
		for _, activation := range sheet.Activations {
			activations[activation.Key] = true
		}
	}
	for key, value := range input.Play.ResourceUses {
		old, saved := previous.Play.ResourceUses[key]
		if !resources[key] && saved && value == old && issues["resource:"+key] {
			delete(input.Play.ResourceUses, key)
			changed = true
		}
	}
	for key, value := range input.Play.ActiveFeatures {
		old, saved := previous.Play.ActiveFeatures[key]
		if !activations[key] && saved && value == old && issues["activation:"+key] {
			delete(input.Play.ActiveFeatures, key)
			changed = true
		}
	}
	return changed
}
