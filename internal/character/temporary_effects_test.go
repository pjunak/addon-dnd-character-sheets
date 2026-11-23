package character

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	model "github.com/pjunak/addon-dnd-engine/character"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

// The worker always asks the Engine for temporary effect marks and passes
// them on in the response's evaluation, but never saves them: they are
// derived, so the stored format stays as released.
func TestTemporaryEffectsTravelInTheEvaluationOnly(t *testing.T) {
	c, data, engine, meta := fixture(t)
	bonus := 1
	engine.marks = []model.TemporaryEffect{{Path: "derived.armorClass", Tone: model.ToneBonus, Causes: []model.EffectCause{{
		Kind: model.CauseTimedGrant, ID: "shrine", Name: "Shrine blessing", Tone: model.ToneBonus,
		Changes: []model.EffectChange{{Kind: model.ChangeAdd, Value: &bonus, Included: new(bool)}},
	}}}}
	input := model.Blank()
	saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "first-save", Inputs: &input})
	if err != nil || saved.Status != "ready" {
		t.Fatalf("save: %+v %v", saved, err)
	}
	if !reflect.DeepEqual(saved.Evaluation.Sheet.TemporaryEffects, engine.marks) {
		t.Fatal("the evaluation lost its marks", saved.Evaluation.Sheet.TemporaryEffects)
	}
	if saved.State.Projection.Sheet.TemporaryEffects != nil || data.state.Projection.Sheet.TemporaryEffects != nil {
		t.Fatal("marks were saved with the sheet")
	}
	validateStored(t, raw(data.state))
	loaded, err := invoke(t, c, meta, "load", Request{})
	if err != nil || !reflect.DeepEqual(loaded.Evaluation.Sheet.TemporaryEffects, engine.marks) || loaded.State.Projection.Sheet.TemporaryEffects != nil {
		t.Fatalf("load: %+v %v", loaded, err)
	}
	if engine.unasked != 0 || engine.calls == 0 {
		t.Fatalf("%d of %d Engine calls did not ask for temporary effects", engine.unasked, engine.calls)
	}
}

// A sheet saved before marks existed loads unchanged and gains marks from
// the evaluation alone.
func TestASheetSavedBeforeMarksLoadsWithThem(t *testing.T) {
	c, data, engine, meta := fixture(t)
	engine.marks = []model.TemporaryEffect{{Path: "derived.speed", Tone: model.TonePenalty, Causes: []model.EffectCause{{
		Kind: model.CauseCondition, ID: "held", Name: "Held", Tone: model.TonePenalty, Changes: []model.EffectChange{{Kind: model.ChangeSet}},
	}}}}
	input := model.Blank()
	if _, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "before-marks", Inputs: &input}); err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(data.state)
	data.body, data.state = before, nil
	loaded, err := invoke(t, c, meta, "load", Request{})
	if err != nil || loaded.Status != "ready" || len(loaded.Evaluation.Sheet.TemporaryEffects) != 1 {
		t.Fatalf("load: %+v %v", loaded, err)
	}
	if after, _ := json.Marshal(loaded.State); !bytes.Equal(before, after) {
		t.Fatal("loading changed the saved sheet")
	}
}

func validateStored(t *testing.T, body []byte) {
	t.Helper()
	schemaBody, err := os.ReadFile(filepath.Join("..", "..", "contracts", "sheet-state.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	document, err := jsonschema.UnmarshalJSON(bytes.NewReader(schemaBody))
	if err != nil {
		t.Fatal(err)
	}
	compiler := jsonschema.NewCompiler()
	compiler.DefaultDraft(jsonschema.Draft2020)
	if err := compiler.AddResource("file:///addon/contracts/sheet-state.schema.json", document); err != nil {
		t.Fatal(err)
	}
	schema, err := compiler.Compile("file:///addon/contracts/sheet-state.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if err := schema.Validate(value); err != nil {
		t.Fatal("the saved sheet does not match the stored schema:", err)
	}
}
