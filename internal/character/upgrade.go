package character

import (
	"encoding/json"
	"fmt"
	"sort"
)

// Upgrade converts one saved sheet from an older stored format to the next
// one. It receives and returns the plain JSON object and must set the new
// "schemaVersion".
type Upgrade func(map[string]any) (map[string]any, error)

// upgrades holds one entry per older stored format the current release still
// reads, keyed by that format's schemaVersion. Saved sheets are upgraded when
// the worker loads them and written in the current format on their next save.
// See docs/RULES_EDGE_CASES.md#changing-the-stored-format.
var upgrades = map[string]Upgrade{}

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
	}
	if err := decode(body, &state); err != nil {
		return state, err
	}
	if state.SchemaVersion != SchemaVersion {
		return state, fmt.Errorf("unsupported stored format %q", state.SchemaVersion)
	}
	return state, nil
}
