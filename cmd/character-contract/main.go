package main

import (
	"encoding/json"
	"github.com/pjunak/addon-dnd-character-sheets/internal/character"
	model "github.com/pjunak/addon-dnd-engine/character"
	"os"
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
	write("sheet-state.schema.json", model.Schema(character.State{}))
	write("character.request.schema.json", model.Schema(character.Request{}))
	response := model.Schema(character.Response{})
	write("character.response.schema.json", response)
	methods := map[string]any{}
	for _, method := range []string{"load", "evaluate", "save", "preview", "commit"} {
		methods[method] = map[string]any{"requestSchema": "contracts/character.request.schema.json", "responseSchema": "contracts/character.response.schema.json", "maxDeadlineMs": 30000, "idempotency": "none", "errors": []string{"INVALID_REQUEST", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT", "UNAVAILABLE", "VALIDATION_FAILED", "RATE_LIMITED", "STALE_BINDING"}}
	}
	write("character.service.json", map[string]any{"$schema": "https://junak.eu/ttrpg-codex/contracts/addons/v3/service-document.schema.json", "contract": character.Contract, "version": character.Version, "allowsExclusive": false, "methods": methods})
}
