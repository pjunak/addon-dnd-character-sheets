package character

import (
	"bytes"
	"encoding/json"
	"slices"

	model "github.com/pjunak/addon-dnd-engine/character"
)

func preservesClassReplacements(before, after model.Inputs, change map[string]any) bool {
	if change["operation"] != "replace-class-choice" {
		return slices.Equal(before.Build.Replacements, after.Build.Replacements)
	}
	if len(after.Build.Replacements) != len(before.Build.Replacements)+1 || !slices.Equal(before.Build.Replacements, after.Build.Replacements[:len(before.Build.Replacements)]) {
		return false
	}
	entry := after.Build.Replacements[len(before.Build.Replacements)]
	level := 0
	for _, row := range before.Build.Levels {
		if row.ClassID == entry.ClassID {
			level++
		}
	}
	if entry.Origin != "recorded" || entry.ClassID == "" || entry.ClassLevel != level || entry.ClassLevel < 2 ||
		entry.Kind != change["kind"] || entry.Key != change["key"] || entry.Out != change["out"] || entry.In != change["ref"] ||
		entry.Out == entry.In || entry.In == "" || entry.Slot < 0 || entry.Source.ID == "" || !slices.Contains([]string{"class", "subclass", "feature"}, entry.Source.Kind) {
		return false
	}
	for _, old := range before.Build.Replacements {
		if old.Source == entry.Source && old.ClassID == entry.ClassID && old.ClassLevel == level && old.Kind == entry.Kind && old.Key == entry.Key {
			return false
		}
	}
	expected := cloneInputs(before)
	if entry.Kind == "feat" {
		found := false
		for i := range expected.Build.Choices {
			choice := &expected.Build.Choices[i]
			if choice.ID != entry.Key || choice.Slot != entry.Slot {
				continue
			}
			var value string
			if json.Unmarshal(choice.Value, &value) != nil || value != entry.Out {
				return false
			}
			choice.Value = raw(entry.In)
			found = true
		}
		if !found {
			return false
		}
	} else if entry.Kind == "spell" {
		selected := expected.Build.Spells.GrantChoices[entry.Key]
		if entry.Slot >= len(selected) || selected[entry.Slot] != entry.Out || slices.Contains(selected, entry.In) {
			return false
		}
		selected[entry.Slot] = entry.In
	} else {
		return false
	}
	expected.Build.Replacements = append(expected.Build.Replacements, entry)
	return bytes.Equal(raw(expected), raw(after))
}
