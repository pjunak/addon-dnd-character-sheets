package character

import (
	model "github.com/pjunak/addon-dnd-engine/character"
	"testing"
)

func TestPlacementResponsePreservationAndExactDepletion(t *testing.T) {
	before := model.Blank().Play
	before.Inventory = []model.Item{{ID: "one", Quantity: 1, Location: "equipped", BodyPlacement: "face"}, {ID: "two", Quantity: 2, Location: "equipped", BodyPlacement: "neck"}}
	for _, scenario := range []string{"drop", "replace", "new", "wrong-command", "wrong-item", "extra-field", "not-depleted", "wrong-location", "still-attuned", "valid-depletion"} {
		t.Run(scenario, func(t *testing.T) {
			after := before
			after.Inventory = append([]model.Item{}, before.Inventory...)
			change := map[string]any{"operation": "consume-item", "itemId": "one"}
			if scenario == "replace" {
				after.Inventory[0].BodyPlacement = "legs"
			} else if scenario == "new" {
				after.Inventory = append(after.Inventory, model.Item{ID: "three", BodyPlacement: "feet"})
			} else {
				after.Inventory[0].BodyPlacement = ""
				after.Inventory[0].Quantity = 0
				after.Inventory[0].Location = "carried"
			}
			switch scenario {
			case "drop":
				change = nil
			case "wrong-command":
				change["operation"] = "rest"
			case "wrong-item":
				change["itemId"] = "two"
			case "extra-field":
				change["other"] = true
			case "not-depleted":
				after.Inventory[0].Quantity = 1
			case "wrong-location":
				after.Inventory[0].Location = "stored"
			case "still-attuned":
				after.Inventory[0].Attuned = true
			}
			if preservesPlacement(before, after, change) != (scenario == "valid-depletion") {
				t.Fatal("unexpected response acceptance", scenario)
			}
		})
	}
	if !preservesPlacement(before, before, nil) {
		t.Fatal("unchanged placement rejected")
	}
}
