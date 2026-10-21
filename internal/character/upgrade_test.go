package character

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	model "github.com/pjunak/addon-dnd-engine/character"
)

func TestOlderStoredFormatsUpgradeOnLoad(t *testing.T) {
	current := State{SchemaVersion: SchemaVersion, Inputs: model.Blank(), Projection: Projection{
		Sheet: model.Sheet{Status: model.SheetNeedsChoices}, Explanations: map[string]model.Explanation{}, Evidence: []model.Evidence{}, Issues: []model.Issue{},
	}}
	var stored map[string]any
	if err := json.Unmarshal(raw(current), &stored); err != nil {
		t.Fatal(err)
	}
	// Two synthetic older formats: "3" kept the operation under another name
	// and "4" lacked the rules block.
	stored["schemaVersion"] = "3"
	stored["lastOperation"] = "operation-one"
	delete(stored, "operationId")
	delete(stored, "rules")
	saved := upgrades
	t.Cleanup(func() { upgrades = saved })
	upgrades = map[string]Upgrade{
		"3": func(value map[string]any) (map[string]any, error) {
			value["operationId"] = value["lastOperation"]
			delete(value, "lastOperation")
			value["schemaVersion"] = "4"
			return value, nil
		},
		"4": func(value map[string]any) (map[string]any, error) {
			value["rules"] = map[string]any{"engineId": "", "engineVersion": "", "engineGeneration": "", "identity": nil}
			value["schemaVersion"] = SchemaVersion
			return value, nil
		},
	}
	if versions := LegacySchemaVersions(); strings.Join(versions, ",") != "3,4" {
		t.Fatalf("legacy versions = %v", versions)
	}
	state, err := decodeState(raw(stored))
	if err != nil || state.SchemaVersion != SchemaVersion || state.OperationID != "operation-one" {
		t.Fatalf("upgraded = %+v, %v", state, err)
	}

	stored["schemaVersion"] = "2"
	if _, err := decodeState(raw(stored)); err == nil {
		t.Fatal("an unknown stored format was accepted")
	}
	upgrades["5"] = func(value map[string]any) (map[string]any, error) {
		value["schemaVersion"] = "5"
		return value, nil
	}
	stored["schemaVersion"] = "5"
	if _, err := decodeState(raw(stored)); err == nil {
		t.Fatal("an upgrade that never reaches the current format was accepted")
	}
}

func TestCurrentStoredFormatStaysStrict(t *testing.T) {
	body := raw(State{SchemaVersion: SchemaVersion, Inputs: model.Blank()})
	if _, err := decodeState(body); err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	_ = json.Unmarshal(body, &value)
	value["unexpected"] = true
	if _, err := decodeState(raw(value)); err == nil {
		t.Fatal("an unknown field was accepted")
	}
}

func TestFormat5SheetsKeepInputsAndRecomputeTheirProjection(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("testdata", "sheet-state-5.0.0.json"))
	if err != nil {
		t.Fatal(err)
	}
	var stored struct {
		Inputs model.Inputs `json:"inputs"`
	}
	if err := json.Unmarshal(body, &stored); err != nil {
		t.Fatal(err)
	}
	c, data, _, meta := fixture(t)
	data.body, data.revision = body, 4
	loaded, err := invoke(t, c, meta, "load", Request{})
	if err != nil || loaded.State == nil || loaded.State.SchemaVersion != SchemaVersion {
		t.Fatal("the 5.0.0 sheet did not load", loaded, err)
	}
	if !reflect.DeepEqual(raw(loaded.State.Inputs), raw(stored.Inputs)) {
		t.Fatal("upgrading changed the saved inputs")
	}
	// The fake Engine reports the gold as the currency worth.
	worth := loaded.State.Projection.Sheet.CurrencyWorth
	if worth == nil || worth.Value != stored.Inputs.Play.Currency["gp"] || data.writes != 0 {
		t.Fatal("the projection was not recomputed from the saved inputs, or loading wrote", loaded.State.Projection.Sheet.Status, data.writes)
	}
	// Without rules the converted projection keeps the sheet readable.
	c, data, engine, meta := fixture(t)
	data.body, data.revision, engine.unavailable = body, 4, true
	offline, err := invoke(t, c, meta, "load", Request{})
	if err != nil || offline.State == nil || offline.State.Projection.Sheet.Calculation == nil || offline.State.Projection.Sheet.Status != model.SheetCalculated {
		t.Fatal("the converted projection is not readable without rules", offline, err)
	}
}
