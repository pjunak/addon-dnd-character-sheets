package character

import (
	"bytes"
	"context"
	"testing"

	model "github.com/pjunak/addon-dnd-engine/character"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

func replacementState() (model.Inputs, model.Inputs, map[string]any) {
	before := model.Blank()
	before.Build.Levels = []model.Level{{ID: "one", ClassID: "martial"}, {ID: "two", ClassID: "martial"}}
	before.Build.Choices = []model.Choice{{ID: "training", Value: raw("first")}}
	before.Notes = "Keep authored notes"
	after := cloneInputs(before)
	after.Build.Choices[0].Value = raw("second")
	after.Build.Replacements = []model.ClassReplacement{{Origin: "recorded", Source: model.Reference{Kind: "feature", ID: "training"}, ClassID: "martial", ClassLevel: 2, Kind: "feat", Key: "training", Out: "first", In: "second"}}
	return before, after, map[string]any{"operation": "replace-class-choice", "kind": "feat", "key": "training", "out": "first", "ref": "second"}
}

func TestReplacementProviderCanOnlyChangeTheExactChoiceAndAppendOneEntry(t *testing.T) {
	before, after, command := replacementState()
	if !preservesClassReplacements(before, after, command) {
		t.Fatal("bounded replacement rejected")
	}
	for name, mutate := range map[string]func(*model.Inputs){
		"notes":          func(i *model.Inputs) { i.Notes = "Rewritten" },
		"play":           func(i *model.Inputs) { i.Play.HP = 7 },
		"levels":         func(i *model.Inputs) { i.Build.Levels[0].ID = "Rewritten" },
		"missing choice": func(i *model.Inputs) { i.Build.Choices = nil },
		"wrong choice":   func(i *model.Inputs) { i.Build.Choices[0].Value = raw("other") },
		"missing entry":  func(i *model.Inputs) { i.Build.Replacements = nil },
		"extra entry":    func(i *model.Inputs) { i.Build.Replacements = append(i.Build.Replacements, i.Build.Replacements[0]) },
		"wrong level":    func(i *model.Inputs) { i.Build.Replacements[0].ClassLevel = 3 },
		"wrong source":   func(i *model.Inputs) { i.Build.Replacements[0].Source.Kind = "spell" },
		"wrong slot":     func(i *model.Inputs) { i.Build.Replacements[0].Slot = 1 },
		"wrong origin":   func(i *model.Inputs) { i.Build.Replacements[0].Origin = "import" },
	} {
		t.Run(name, func(t *testing.T) {
			changed := cloneInputs(after)
			mutate(&changed)
			if preservesClassReplacements(before, changed, command) {
				t.Fatal("provider changed state outside the replacement command")
			}
		})
	}
	if preservesClassReplacements(before, after, nil) || preservesClassReplacements(after, before, map[string]any{"operation": "rest"}) {
		t.Fatal("ordinary evaluation or rest changed the ledger")
	}
	before.Build.Replacements = after.Build.Replacements
	after.Build.Replacements = append(after.Build.Replacements, after.Build.Replacements[0])
	if preservesClassReplacements(before, after, command) {
		t.Fatal("the same allowance was spent twice")
	}
}

func TestReplacementProviderPreservesSiblingSpellSelections(t *testing.T) {
	before, after, command := replacementState()
	before.Build.Spells.GrantChoices["training"] = []string{"first", "sibling"}
	after = cloneInputs(before)
	after.Build.Spells.GrantChoices["training"][0] = "second"
	_, feat, _ := replacementState()
	after.Build.Replacements = feat.Build.Replacements
	after.Build.Replacements[0].Kind = "spell"
	command["kind"] = "spell"
	if !preservesClassReplacements(before, after, command) {
		t.Fatal("bounded spell replacement rejected")
	}
	after.Build.Spells.GrantChoices["training"][1] = "lost"
	if preservesClassReplacements(before, after, command) {
		t.Fatal("lost the other chosen spell")
	}
}

func TestReplacementSaveProtectsHistoryAndRetriesAcrossWorkerRestart(t *testing.T) {
	c, data, engine, meta := fixture(t)
	before, after, command := replacementState()
	if _, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "forged-ledger", Summary: "Forge history", Inputs: &after}); err == nil {
		t.Fatal("ordinary creation accepted a forged replacement")
	}
	saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "initial-character", Summary: "Create character", Inputs: &before})
	if err != nil {
		t.Fatal(err)
	}
	c.engine = providerCall(func(ctx context.Context, meta *workerrpc.Meta, request workerrpc.ServiceCall) (workerrpc.ServiceResult, error) {
		result, err := engine.Call(ctx, meta, request)
		if request.Method == "character-play" {
			var value evaluated
			_ = decode(result.Result, &value)
			value.Evaluation.Inputs.Build.Choices = after.Build.Choices
			value.Evaluation.Inputs.Build.Replacements = after.Build.Replacements
			result.Result = raw(value)
		}
		return result, err
	})
	request := Request{Operation: "play", OperationID: "replace-training", Summary: "Replace training", ExpectedRevision: saved.Revision, Change: command}
	saved, err = invoke(t, c, meta, "save", request)
	if err != nil || saved.Revision != 2 {
		t.Fatalf("save: %+v %v", saved, err)
	}
	state := raw(saved.State)
	restarted := New(data, c.engine)
	again, err := invoke(t, restarted, meta, "save", request)
	if err != nil || again.Revision != 2 || data.writes != 2 || !bytes.Equal(raw(again.State), state) {
		t.Fatal("retry replayed a replacement", err)
	}
	for name, ledger := range map[string][]model.ClassReplacement{"drop": nil, "rewrite": {{Origin: "recorded", Kind: "feat", Key: "other"}}} {
		changed := cloneInputs(saved.State.Inputs)
		changed.Build.Replacements = ledger
		if _, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "edit-" + name, Summary: "Edit history", ExpectedRevision: 2, Inputs: &changed}); err == nil {
			t.Fatal("Builder changed replacement history", name)
		}
	}
	c.engine = providerCall(func(ctx context.Context, meta *workerrpc.Meta, request workerrpc.ServiceCall) (workerrpc.ServiceResult, error) {
		result, err := engine.Call(ctx, meta, request)
		var value evaluated
		_ = decode(result.Result, &value)
		value.Evaluation.Inputs.Build.Replacements = nil
		result.Result = raw(value)
		return result, err
	})
	loaded, err := invoke(t, c, meta, "load", Request{})
	if err != nil || loaded.Status != "unavailable" || !bytes.Equal(raw(loaded.State), state) || data.writes != 2 {
		t.Fatal("older provider changed or hid the saved replacement", err)
	}
}
