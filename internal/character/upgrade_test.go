package character

import (
	"encoding/json"
	"strings"
	"testing"

	model "github.com/pjunak/addon-dnd-engine/character"
)

func TestOlderStoredFormatsUpgradeOnLoad(t *testing.T) {
	current := State{SchemaVersion: SchemaVersion, Inputs: model.Blank(), Projection: Projection{
		Sheet: map[string]any{}, Explanations: map[string]model.Explanation{}, Evidence: []model.Evidence{}, Issues: []model.Issue{},
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
