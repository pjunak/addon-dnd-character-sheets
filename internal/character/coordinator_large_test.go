package character

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	model "github.com/pjunak/addon-dnd-engine/character"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

type largeProjectionEngine struct{ *fakeEngine }

func (engine largeProjectionEngine) Call(ctx context.Context, meta *workerrpc.Meta, call workerrpc.ServiceCall) (workerrpc.ServiceResult, error) {
	response, err := engine.fakeEngine.Call(ctx, meta, call)
	if err != nil {
		return response, err
	}
	var result evaluated
	if err := json.Unmarshal(response.Result, &result); err != nil {
		return response, err
	}
	fields := map[string]any{}
	for i := 0; i < 600; i++ {
		fields[fmt.Sprintf("stat-%03d", i)] = result.Evaluation.Inputs.Play.Currency["gp"]
	}
	result.Evaluation.Sheet["derived"] = fields
	response.Result = raw(result)
	return response, nil
}

// largeCharacter is a long-played wizard whose Engine payload is exactly size
// bytes: twelve levels, spells, storage and hundreds of inventory entries with
// notes. The last entry's notes take up the remainder.
func largeCharacter(t *testing.T, size int) model.Inputs {
	t.Helper()
	input := model.Blank()
	input.Build.Species = "species-elf"
	input.Build.Background = "background-sage"
	input.Build.BaseScores = map[string]int{"STR": 8, "DEX": 14, "CON": 13, "INT": 15, "WIS": 12, "CHA": 10}
	for level := 1; level <= 12; level++ {
		input.Build.Levels = append(input.Build.Levels, model.Level{ID: fmt.Sprintf("level-%02d", level), ClassID: "class-wizard"})
	}
	input.Build.Spells.Cantrips = map[string][]string{"class-wizard": {"spell-fire-bolt", "spell-light", "spell-mage-hand", "spell-message"}}
	input.Build.Spells.Spellbook = map[string][]string{"class-wizard": {"spell-detect-magic", "spell-shield", "spell-misty-step", "spell-counterspell", "spell-fireball", "spell-fly"}}
	input.Play.HP = 62
	input.Play.Currency = map[string]float64{"gp": 1250, "sp": 38, "cp": 112}
	input.Play.Containers = []model.Container{{ID: "backpack", Name: "Backpack"}, {ID: "inn-chest", Name: "Chest at the inn"}}
	// The fixture clock; every evaluation stamps the same length of time.
	input.Play.AsOf = "2026-09-11T12:00:00Z"
	note := "Recovered from the drowned archive; the margins hold a second cipher. "
	item := func(notes string) model.Item {
		index := len(input.Play.Inventory)
		container, location := "backpack", "carried"
		if index%3 == 0 {
			container, location = "inn-chest", "stored"
		}
		return model.Item{ID: fmt.Sprintf("item-%03d", index), ContainerID: container, Reference: &model.Reference{Kind: "gear", ID: "gear-curio"}, Name: fmt.Sprintf("Curio %d", index), Quantity: 1, Location: location, Acquisition: "Found on the road", Notes: notes}
	}
	for len(raw(payload(input, nil))) < size-1000 {
		input.Play.Inventory = append(input.Play.Inventory, item(strings.Repeat(note, 5)))
	}
	input.Play.Inventory = append(input.Play.Inventory, item(""))
	remaining := size - len(raw(payload(input, nil)))
	input.Play.Inventory[len(input.Play.Inventory)-1].Notes = strings.Repeat(note, remaining/len(note)+1)[:remaining]
	if got := len(raw(payload(input, nil))); got != size {
		t.Fatalf("large character is %d bytes, want %d", got, size)
	}
	return input
}

func TestCharacterDataOverTheEngineLimitIsTooLarge(t *testing.T) {
	c, data, engine, meta := fixture(t)
	input := largeCharacter(t, model.MaxRequestBytes)
	saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "largest-character", Inputs: &input})
	if err != nil || saved.Status != "ready" || data.writes != 1 {
		t.Fatal("the largest character the Engine accepts was refused", saved.Status, saved.Message, err)
	}
	tooLarge := func(response Response, err error, size int) {
		t.Helper()
		want := fmt.Sprintf("This character is %d bytes; the rules engine accepts at most %d. Remove inventory entries or shorten item notes, then try again.", size, model.MaxRequestBytes)
		if err != nil || response.Status != "too-large" || response.Message != want || data.writes != 1 {
			t.Fatalf("answered %q %q %v, want too-large %q", response.Status, response.Message, err, want)
		}
	}
	// The Engine is never asked to evaluate a payload it would refuse.
	calls := engine.calls
	larger := largeCharacter(t, model.MaxRequestBytes+1)
	refused, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "larger-character", Inputs: &larger, ExpectedRevision: saved.Revision})
	tooLarge(refused, err, model.MaxRequestBytes+1)
	// A play command adds its change to the saved inputs.
	change := map[string]any{"operation": "rest", "rest": "short"}
	refused, err = invoke(t, c, meta, "save", Request{Operation: "play", OperationID: "rest-at-the-limit", Change: change, ExpectedRevision: saved.Revision})
	tooLarge(refused, err, len(raw(payload(data.state.Inputs, change))))
	if engine.calls != calls {
		t.Fatal("an oversized payload reached the Engine")
	}
	// A saved character over the limit stays readable without rules.
	data.state.Inputs = larger
	loaded, err := invoke(t, c, meta, "load", Request{})
	if err != nil || loaded.Status != "unavailable" || loaded.State == nil || !strings.HasPrefix(loaded.Message, fmt.Sprintf("This character is %d bytes;", model.MaxRequestBytes+1)) || engine.calls != calls {
		t.Fatal("an oversized saved character was not readable", loaded.Status, loaded.Message, err)
	}
}

// evidenceEngine saves the longest rules evidence (800-character summaries)
// for many referenced records.
type evidenceEngine struct {
	*fakeEngine
	records int
}

func (engine evidenceEngine) Call(ctx context.Context, meta *workerrpc.Meta, call workerrpc.ServiceCall) (workerrpc.ServiceResult, error) {
	response, err := engine.fakeEngine.Call(ctx, meta, call)
	if err != nil {
		return response, err
	}
	var result evaluated
	if err := json.Unmarshal(response.Result, &result); err != nil {
		return response, err
	}
	for index := 0; index < engine.records; index++ {
		result.Evaluation.Evidence = append(result.Evaluation.Evidence, model.Evidence{Reference: model.Reference{Kind: "spell", ID: fmt.Sprintf("spell-%03d", index)}, Name: fmt.Sprintf("Spell %d", index), Hash: strings.Repeat("0", 64), Summary: strings.Repeat("s", 800), Facts: map[string]any{}})
	}
	response.Result = raw(result)
	return response, nil
}

func TestSavedSnapshotOverTheStorageLimitIsTooLarge(t *testing.T) {
	original, data, engine, meta := fixture(t)
	input := largeCharacter(t, 170000)
	for _, records := range []int{50, 120} {
		c := New(data, evidenceEngine{engine, records})
		c.now = original.now
		response, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: fmt.Sprintf("evidence-%d", records), Inputs: &input, ExpectedRevision: data.revision})
		if records == 50 && (err != nil || response.Status != "ready" || data.writes != 1) {
			t.Fatal("a snapshot under the storage limit was refused", response.Status, response.Message, err)
		}
		if records == 120 && (err != nil || response.Status != "too-large" || data.writes != 1 || !strings.HasPrefix(response.Message, "This character's saved snapshot would be ") || !strings.Contains(response.Message, fmt.Sprintf("the storage limit is %d.", storedLimit))) {
			t.Fatal("an oversized snapshot was not refused with its size", response.Status, response.Message, err)
		}
	}
}

func TestLargeProjectionSaveAcknowledgesWithoutReviewDiff(t *testing.T) {
	original, data, engine, meta := fixture(t)
	c := New(data, largeProjectionEngine{engine})
	c.now = original.now
	input := model.Blank()
	request := Request{Operation: "build", OperationID: "large-initial", Inputs: &input}
	first, err := invoke(t, c, meta, "save", request)
	if err != nil || first.Status != "ready" {
		t.Fatalf("initial: %+v %v", first, err)
	}
	input.Play.Currency = map[string]float64{"gp": 16}
	request.OperationID = "large-change"
	request.ExpectedRevision = first.Revision
	saved, err := invoke(t, c, meta, "save", request)
	if err != nil || saved.Status != "ready" || saved.Revision != first.Revision+1 || len(saved.Changes) != 0 || saved.State == nil || len(saved.State.Projection.Sheet["derived"].(map[string]any)) != 600 {
		t.Fatalf("large save did not produce a bounded acknowledgment: %+v %v", saved, err)
	}
	retry, err := invoke(t, c, meta, "save", request)
	if err != nil || retry.Revision != saved.Revision || data.writes != 2 || !reflect.DeepEqual(raw(retry.State), raw(saved.State)) {
		t.Fatal("large save retry changed state", err)
	}
	input.Play.Currency = map[string]float64{"gp": 49}
	preview := review(t, c, meta, Request{Operation: "import", OperationID: "large-import", ExpectedRevision: saved.Revision, Inputs: &input})
	if len(preview.Changes) == 0 || len(preview.Changes) > 500 || data.writes != 2 {
		t.Fatal("review missing, oversized or wrote state")
	}
	found := false
	for _, change := range preview.Changes {
		if change.Path == "/projection/sheet/derived" {
			found = true
			if len(change.Before.(map[string]any)) != 600 || len(change.After.(map[string]any)) != 600 {
				t.Fatal("grouping dropped changed statistics")
			}
		}
	}
	if !found {
		t.Fatal("large projection changes must remain reviewable")
	}
	committed, err := invoke(t, c, meta, "commit", Request{Token: preview.Token, OperationID: "large-import", ExpectedRevision: saved.Revision})
	if err != nil || committed.State.Inputs.Play.Currency["gp"] != input.Play.Currency["gp"] || data.writes != 3 {
		t.Fatal("review did not commit its exact state", err)
	}
}

func TestReviewDiffRetainsAllValuesWhenSeveralGroupsExceedTheLimit(t *testing.T) {
	before := &State{Inputs: model.Blank(), Rules: RulesContext{Identity: map[string]any{}}, Projection: Projection{Sheet: map[string]any{"derived": map[string]any{}}}}
	after := &State{Inputs: model.Blank(), Rules: RulesContext{Identity: map[string]any{}}, Projection: Projection{Sheet: map[string]any{"derived": map[string]any{}}}}
	for i := 0; i < 600; i++ {
		key := fmt.Sprintf("value-%03d", i)
		before.Inputs.Play.ResourceUses[key] = 0
		after.Inputs.Play.ResourceUses[key] = 1
		before.Rules.Identity[key] = 0
		after.Rules.Identity[key] = 1
		before.Projection.Sheet["derived"].(map[string]any)[key] = 0
		after.Projection.Sheet["derived"].(map[string]any)[key] = 1
	}
	changes := diff(before, after)
	if len(changes) != 3 {
		t.Fatal("expected three complete bounded groups", len(changes))
	}
	for _, change := range changes {
		left, right := change.Before.(map[string]any), change.After.(map[string]any)
		if len(left) != 600 || len(right) != 600 {
			t.Fatal("diff truncated a group", change.Path)
		}
		for key, value := range left {
			if value != float64(0) || right[key] != float64(1) {
				t.Fatal("changed values were lost", key)
			}
		}
	}
	if !reflect.DeepEqual(changes, diff(before, after)) {
		t.Fatal("grouped review is not deterministic")
	}
}
