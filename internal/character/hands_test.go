package character

import (
	"encoding/json"
	"testing"

	model "github.com/pjunak/addon-dnd-engine/character"
)

func copyPlay(play model.Play) model.Play {
	body, _ := json.Marshal(play)
	var result model.Play
	_ = json.Unmarshal(body, &result)
	return result
}

func TestHandCommandsPreserveEveryUnrelatedAuthoredValue(t *testing.T) {
	before := model.Blank().Play
	before.Hands = &model.Hands{Main: "blade", Off: "shield", Grip: "one"}
	before.Inventory = []model.Item{{ID: "blade", Quantity: 1, Location: "equipped", Notes: "Blade"}, {ID: "shield", Quantity: 1, Location: "equipped", Attuned: true, Acquisition: "Reward", Notes: "Crest", BodyPlacement: "other"}, {ID: "spare", Quantity: 2, Location: "stored", ContainerID: "pack"}}
	before.Containers = []model.Container{{ID: "pack", Name: "Pack"}}
	after := copyPlay(before)
	after.Inventory[1].Location, after.Inventory[1].BodyPlacement = "carried", ""
	after.Hands = &model.Hands{Main: "blade", Grip: "two", SuspendedOff: &model.SuspendedHand{ItemID: "shield", ExpectedItemSHA256: model.HandItemFingerprint(after.Inventory[1]), BodyPlacement: "other"}}
	command := map[string]any{"operation": "set-grip", "grip": "two"}
	if !preservesEquipment(before, after, command) {
		t.Fatal("bounded suspension rejected")
	}
	if !preservesEquipment(after, before, map[string]any{"operation": "set-grip", "grip": "one"}) {
		t.Fatal("exact restoration rejected")
	}
	if !preservesEquipment(after, after, command) {
		t.Fatal("unchanged repeated grip rejected")
	}
	forgotten := copyPlay(after)
	forgotten.Hands.SuspendedOff = nil
	if preservesEquipment(after, forgotten, command) {
		t.Fatal("repeated grip forgot the suspended item")
	}
	for name, mutate := range map[string]func(*model.Play){
		"main moved":         func(p *model.Play) { p.Inventory[0].Location = "carried" },
		"quantity":           func(p *model.Play) { p.Inventory[1].Quantity = 0 },
		"attunement":         func(p *model.Play) { p.Inventory[1].Attuned = false },
		"notes":              func(p *model.Play) { p.Inventory[1].Notes = "Lost" },
		"other membership":   func(p *model.Play) { p.Inventory[2].ContainerID = "" },
		"other move":         func(p *model.Play) { p.Inventory[2].Location = "carried" },
		"swapped identity":   func(p *model.Play) { p.Hands.Main = "spare" },
		"forged restoration": func(p *model.Play) { p.Hands.SuspendedOff.ExpectedItemSHA256 = "forged" },
		"missing suspension": func(p *model.Play) { p.Hands = nil },
		"forgotten off hand": func(p *model.Play) { p.Hands.SuspendedOff = nil },
		"inspiration":        func(p *model.Play) { value := true; p.Inspiration = &value },
	} {
		t.Run(name, func(t *testing.T) {
			altered := copyPlay(after)
			mutate(&altered)
			if preservesEquipment(before, altered, command) {
				t.Fatal("provider changed unrelated state")
			}
		})
	}
	if preservesEquipment(before, after, nil) || preservesEquipment(after, before, map[string]any{"operation": "rest", "rest": "long"}) {
		t.Fatal("ordinary evaluation changed hand state")
	}
	changed := copyPlay(after)
	changed.Inventory[1].Notes = "Changed after suspension"
	restored := copyPlay(changed)
	restored.Hands = &model.Hands{Main: "blade", Off: "shield", Grip: "one"}
	restored.Inventory[1].Location, restored.Inventory[1].BodyPlacement = "equipped", "other"
	if preservesEquipment(changed, restored, map[string]any{"operation": "set-grip", "grip": "one"}) {
		t.Fatal("provider restored a changed instance")
	}
}

func TestHandCommandsAcceptFreeHandsWithoutRewritingEmptyInventory(t *testing.T) {
	for _, inventory := range [][]model.Item{nil, {}} {
		before := model.Blank().Play
		before.Inventory = inventory
		after := before
		after.Hands = &model.Hands{Grip: "one"}
		if !preservesEquipment(before, after, map[string]any{"operation": "set-hand", "hand": "main", "itemId": ""}) {
			t.Fatal("free hand rejected for empty inventory")
		}
	}
}
