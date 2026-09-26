package character

import (
	model "github.com/pjunak/addon-dnd-engine/character"
	"reflect"
)

// Only consuming the final unit can clear placement as a play-command effect.
// Ordinary evaluated edits must return exactly the submitted assignments.
func preservesPlacement(before, after model.Play, change map[string]any) bool {
	assignments := func(play model.Play) map[string]string {
		result := map[string]string{}
		for _, item := range play.Inventory {
			if item.BodyPlacement != "" {
				result[item.ID] = item.BodyPlacement
			}
		}
		return result
	}
	expected := assignments(before)
	if change["operation"] == "consume-item" && len(change) == 2 {
		for _, item := range before.Inventory {
			if item.ID != change["itemId"] || item.Quantity != 1 || item.Location != "equipped" {
				continue
			}
			for _, next := range after.Inventory {
				if next.ID == item.ID && next.Quantity == 0 && next.Location == "carried" && !next.Attuned {
					delete(expected, item.ID)
				}
			}
		}
	}
	return reflect.DeepEqual(expected, assignments(after))
}
