package character

import (
	"encoding/json"
	"fmt"
	"sort"

	model "github.com/pjunak/addon-dnd-engine/character"
)

// Upgrade converts one saved sheet from an older stored format to the next
// one. It receives and returns the plain JSON object and must set the new
// "schemaVersion".
type Upgrade func(map[string]any) (map[string]any, error)

// upgrades holds one entry per older stored format the current release still
// reads, keyed by that format's schemaVersion. Saved sheets are upgraded when
// the worker loads them and written in the current format on their next save.
// See docs/RULES_EDGE_CASES.md#changing-the-stored-format.
var upgrades = map[string]Upgrade{"5.0.0": upgradeFrom5}

// upgradeFrom5 moves a sheet saved with Engine 5 to the typed projection of
// Engine 6. The saved inputs keep their format. The old projection is read
// into the typed sheet so the character stays readable without rules; the
// coordinator then recomputes it from the saved inputs (see decodeState).
func upgradeFrom5(value map[string]any) (map[string]any, error) {
	projection, _ := value["projection"].(map[string]any)
	if projection == nil {
		return nil, fmt.Errorf("the saved sheet has no projection")
	}
	old, _ := projection["sheet"].(map[string]any)
	projection["sheet"] = sheetFrom5(old)
	value["schemaVersion"] = "6.0.0"
	return value, nil
}

// sheetFrom5 reads an Engine 5 sheet into the typed sheet. Engine 5 set a
// status only on unfinished sheets and wrote numeric label arguments; fields Engine 6 no longer has are
// dropped. A sheet that still does not fit keeps only its status, and the
// recomputed projection replaces it.
func sheetFrom5(old map[string]any) model.Sheet {
	if old == nil {
		return model.Sheet{Status: model.SheetNeedsChoices}
	}
	status := model.SheetCalculated
	if old["status"] == "needs-choices" {
		status = model.SheetNeedsChoices
	}
	if selections, ok := old["selections"].([]any); ok {
		for _, raw := range selections {
			if selection, ok := raw.(map[string]any); ok {
				if args, ok := selection["labelArgs"].([]any); ok {
					for index, arg := range args {
						args[index] = fmt.Sprint(arg)
					}
				}
			}
		}
	}
	delete(old, "status")
	var sheet model.Sheet
	if json.Unmarshal(raw(old), &sheet) != nil {
		sheet = model.Sheet{}
	}
	sheet.Status = status
	if status == model.SheetNeedsChoices {
		sheet.Calculation = nil
	}
	model.FillEmpty(&sheet)
	return sheet
}

// LegacySchemaVersions lists the older stored formats this release reads.
func LegacySchemaVersions() []string {
	versions := make([]string, 0, len(upgrades))
	for version := range upgrades {
		versions = append(versions, version)
	}
	sort.Strings(versions)
	return versions
}

// decodeState reads a saved sheet, upgrading an older stored format first.
// Unknown formats fail; nothing is partially normalized.
func decodeState(body []byte) (State, error) {
	var state State
	var probe struct {
		SchemaVersion string `json:"schemaVersion"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		return state, err
	}
	if probe.SchemaVersion != SchemaVersion {
		var value map[string]any
		if err := json.Unmarshal(body, &value); err != nil {
			return state, err
		}
		version := probe.SchemaVersion
		for steps := 0; version != SchemaVersion; steps++ {
			upgrade, known := upgrades[version]
			if !known || steps > len(upgrades) {
				return state, fmt.Errorf("unsupported stored format %q", version)
			}
			upgraded, err := upgrade(value)
			if err != nil {
				return state, fmt.Errorf("upgrade stored format %q: %w", version, err)
			}
			value = upgraded
			version, _ = value["schemaVersion"].(string)
		}
		body = raw(value)
		state.upgraded = true
	}
	upgraded := state.upgraded
	if err := decode(body, &state); err != nil {
		return state, err
	}
	state.upgraded = upgraded
	if state.SchemaVersion != SchemaVersion {
		return state, fmt.Errorf("unsupported stored format %q", state.SchemaVersion)
	}
	return state, nil
}
