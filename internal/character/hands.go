package character

import (
	"reflect"
	"slices"

	model "github.com/pjunak/addon-dnd-engine/character"
)

func preservesEquipment(before, after model.Play, change map[string]any) bool {
	if change["operation"] == "set-hand" || change["operation"] == "set-grip" {
		return preservesHandCommand(before, after, change)
	}
	return reflect.DeepEqual(before.Hands, after.Hands) && preservesStorage(before, after) && preservesPlacement(before, after, change)
}

// A rules provider may change only the selected hand state and the locations
// involved in that command. It cannot replace instances, consume quantities,
// drop attunement or rewrite their authored notes, grants or membership.
func preservesHandCommand(before, after model.Play, change map[string]any) bool {
	old := before.Hands
	if old == nil {
		old = &model.Hands{Grip: "one"}
	}
	next := after.Hands
	if next == nil || next.Grip != "one" && next.Grip != "two" || len(before.Inventory) != len(after.Inventory) {
		return false
	}
	allowed := map[string]bool{}
	allowedOff := map[string]bool{"": true, old.Off: true}
	expectedMain := old.Main
	if old.SuspendedOff != nil {
		allowed[old.SuspendedOff.ItemID], allowedOff[old.SuspendedOff.ItemID] = true, true
	}
	switch change["operation"] {
	case "set-hand":
		id, ok := change["itemId"].(string)
		if !ok || len(change) != 3 {
			return false
		}
		allowed[id] = true
		switch change["hand"] {
		case "main":
			allowed[old.Main], allowed[old.Off] = true, true
			expectedMain = id
			if old.SuspendedOff == nil && next.Grip == "one" && next.Off != old.Off {
				return false
			}
		case "off":
			if old.Grip == "two" || next.Off != id || next.Grip != old.Grip {
				return false
			}
			allowed[old.Off] = true
			allowedOff[id] = true
		default:
			return false
		}
	case "set-grip":
		if len(change) != 2 || next.Grip != change["grip"] {
			return false
		}
		if before.Hands != nil && old.Grip == next.Grip {
			return reflect.DeepEqual(before, after)
		}
		if next.Grip == "two" {
			allowed[old.Off] = true
		}
	default:
		return false
	}
	if next.Main != expectedMain || !allowedOff[next.Off] || next.Main != "" && next.Main == next.Off || next.Grip == "two" && next.Off != "" {
		return false
	}
	expected := before
	expected.Hands = after.Hands
	expected.Inventory = slices.Clone(before.Inventory)
	for index, item := range before.Inventory {
		value := after.Inventory[index]
		if item.ID != value.ID {
			return false
		}
		if next.Grip == "two" && old.Off == item.ID && item.Quantity > 0 && item.Location == "equipped" && (next.SuspendedOff == nil || next.SuspendedOff.ItemID != item.ID || value.Location != "carried" || value.BodyPlacement != "") {
			return false
		}
		if old.SuspendedOff != nil && next.Off == old.SuspendedOff.ItemID && item.ID == next.Off && (model.HandItemFingerprint(item) != old.SuspendedOff.ExpectedItemSHA256 || item.Location != "carried") {
			return false
		}
		if allowed[item.ID] {
			if value.Location != item.Location && value.Location != "equipped" && value.Location != "carried" {
				return false
			}
			if value.ContainerID != item.ContainerID && (value.ContainerID != "" || value.Location != "equipped") {
				return false
			}
			if value.BodyPlacement != item.BodyPlacement && value.BodyPlacement != "" && (old.SuspendedOff == nil || old.SuspendedOff.ItemID != item.ID || old.SuspendedOff.BodyPlacement != value.BodyPlacement) {
				return false
			}
			expected.Inventory[index].Location = value.Location
			expected.Inventory[index].ContainerID = value.ContainerID
			expected.Inventory[index].BodyPlacement = value.BodyPlacement
		}
	}
	if suspended := next.SuspendedOff; suspended != nil {
		if next.Grip != "two" || suspended.ItemID == next.Main || suspended.ItemID == next.Off {
			return false
		}
		if old.SuspendedOff != nil && reflect.DeepEqual(old.SuspendedOff, suspended) {
			// Repeated grip commands preserve the original restoration condition.
		} else {
			found := false
			for index, item := range before.Inventory {
				value := after.Inventory[index]
				if item.ID == old.Off && suspended.ItemID == item.ID && item.Location == "equipped" && value.Location == "carried" && suspended.BodyPlacement == item.BodyPlacement && suspended.ExpectedItemSHA256 == model.HandItemFingerprint(value) {
					found = true
				}
			}
			if !found {
				return false
			}
		}
	}
	return reflect.DeepEqual(expected, after)
}
