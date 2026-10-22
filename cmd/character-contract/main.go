package main

import (
	"encoding/json"
	"github.com/pjunak/addon-dnd-character-sheets/internal/character"
	model "github.com/pjunak/addon-dnd-engine/character"
	"os"
	"strconv"
	"strings"
)

func main() {
	writeTypescript()
	write := func(name string, value any) {
		body, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			panic(err)
		}
		if err = os.WriteFile("contracts/"+name, append(body, '\n'), 0644); err != nil {
			panic(err)
		}
	}
	write("sheet-state.schema.json", storedSchema())
	write("character.request.schema.json", model.Schema(character.Request{}))
	response := model.Schema(character.Response{})
	write("character.response.schema.json", response)
	methods := map[string]any{}
	for _, method := range []string{"load", "evaluate", "save", "preview", "commit"} {
		methods[method] = map[string]any{"requestSchema": "contracts/character.request.schema.json", "responseSchema": "contracts/character.response.schema.json", "maxDeadlineMs": 30000, "idempotency": "none", "errors": []string{"INVALID_REQUEST", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT", "UNAVAILABLE", "VALIDATION_FAILED", "RATE_LIMITED", "STALE_BINDING"}}
	}
	write("character.service.json", map[string]any{"$schema": "https://junak.eu/ttrpg-codex/contracts/addons/v3/service-document.schema.json", "contract": character.Contract, "version": character.Version, "allowsExclusive": false, "methods": methods})
}

// storedSchema accepts the current saved format and every older format this
// release still upgrades, so the host can keep existing sheets on update.
// Each older format's schema is frozen in contracts/legacy/.
func storedSchema() any {
	current := model.Schema(character.State{})
	legacy := character.LegacySchemaVersions()
	if len(legacy) == 0 {
		return current
	}
	// The current format's shared definitions stay at the document root, where
	// its references point.
	defs := current["$defs"]
	delete(current, "$defs")
	formats := []any{current}
	for index, version := range legacy {
		body, err := os.ReadFile("contracts/legacy/sheet-state-" + version + ".schema.json")
		if err != nil {
			panic(err)
		}
		var schema any
		if err := json.Unmarshal(body, &schema); err != nil {
			panic(err)
		}
		formats = append(formats, ownReferences(schema, "#/anyOf/"+strconv.Itoa(index+1)))
	}
	return map[string]any{"anyOf": formats, "$defs": defs}
}

// ownReferences points a frozen schema's "#/$defs/…" references at its own
// definitions, which sit under prefix once it is embedded in anyOf, so an
// older format is checked against its own types rather than the current ones.
func ownReferences(value any, prefix string) any {
	switch current := value.(type) {
	case map[string]any:
		for key, child := range current {
			if reference, ok := child.(string); key == "$ref" && ok && strings.HasPrefix(reference, "#/$defs/") {
				current[key] = prefix + reference[1:]
			} else {
				current[key] = ownReferences(child, prefix)
			}
		}
	case []any:
		for index, child := range current {
			current[index] = ownReferences(child, prefix)
		}
	}
	return value
}
