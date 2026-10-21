package character

import (
	model "github.com/pjunak/addon-dnd-engine/character"
)

// playCommand decodes a play command fixture written as a map.
func playCommand(fields map[string]any) *model.PlayCommand {
	command, err := model.DecodePlayCommand(raw(fields))
	if err != nil {
		panic(err)
	}
	return &command
}
