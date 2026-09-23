package character

import (
	"context"
	"encoding/json"
	"net/url"
	"testing"

	model "github.com/pjunak/addon-dnd-engine/character"
)

func TestImportReauthorizesGrantReferencesWithoutChangingTheExport(t *testing.T) {
	c, _, _, meta := fixture(t)
	meta.Actor.Role = "dm"
	input := model.Blank()
	original := "feat:spell-training@grant%3Aexternal:spell"
	rebound := "feat:spell-training@" + url.QueryEscape("grant:grant-reviewed-import-0") + ":spell"
	input.Grants = []model.Grant{{ID: "external", ActorID: "claimed actor", GrantedAt: "claimed time", Name: "Training", Active: true, Effects: []model.Effect{}, Waivers: []string{}}}
	input.Build.Choices = []model.Choice{{ID: original, Value: json.RawMessage(`"arcane"`)}}
	input.Build.Spells.GrantChoices[original] = []string{"spark"}
	input.Play.ResourceUses["charge:"+original] = 1
	input.Play.Inventory = []model.Item{{ID: "focus", GrantID: "external", Notes: "Keep item notes"}}
	input.Build.Rolls = []model.Roll{{ID: "ability", Origin: "recorded", Dice: []int{3}}}
	input.Play.Rolls = []model.PlayRoll{{ID: "die", Origin: "recorded"}}
	input.Build.Spells.Acquisitions = []model.SpellAcquisition{{ID: "copy", Origin: "recorded", CostGP: 50}}
	input.Build.Spells.Swaps = []model.SpellSwap{{Origin: "recorded", In: "spark", Out: "ward"}}
	before := string(raw(input))
	next, err := c.propose(context.Background(), meta, Request{Operation: "import", OperationID: "reviewed-import", Inputs: &input, ReauthorizeGrants: true}, nil, model.Blank())
	if err != nil {
		t.Fatal(err)
	}
	if next.Build.Choices[0].ID != rebound || next.Build.Spells.GrantChoices[rebound][0] != "spark" || next.Play.ResourceUses["charge:"+rebound] != 1 {
		t.Fatal("lost acquired choices or spent resource")
	}
	if next.Play.Inventory[0].GrantID != next.Grants[0].ID || next.Grants[0].ActorID != meta.Actor.ID || next.Grants[0].GrantedAt == "claimed time" {
		t.Fatal("lost authenticated provenance")
	}
	if next.Build.Rolls[0].Origin != "import" || next.Play.Rolls[0].Origin != "import" || next.Build.Spells.Acquisitions[0].Origin != "import" || next.Build.Spells.Swaps[0].Origin != "import" {
		t.Fatal("lost imported claim markers")
	}
	if string(raw(input)) != before {
		t.Fatal("review mutated the supplied export")
	}
}

func TestImportRejectsAmbiguousGrantIdentityWithoutChangingInput(t *testing.T) {
	for _, ids := range [][]string{{""}, {"same", "same"}} {
		c, _, _, meta := fixture(t)
		meta.Actor.Role = "dm"
		input := model.Blank()
		for _, id := range ids {
			input.Grants = append(input.Grants, model.Grant{ID: id})
		}
		before := string(raw(input))
		if _, err := c.propose(context.Background(), meta, Request{Operation: "import", OperationID: "reviewed-import", Inputs: &input, ReauthorizeGrants: true}, nil, model.Blank()); err == nil {
			t.Fatal("ambiguous identity was silently replaced")
		}
		if string(raw(input)) != before {
			t.Fatal("rejected input changed")
		}
	}
}
