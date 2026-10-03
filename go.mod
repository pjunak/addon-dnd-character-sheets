module github.com/pjunak/addon-dnd-character-sheets

go 1.27.1

require (
	github.com/pjunak/addon-dnd-engine v0.0.0-20261002113553-f19f634f6ca5
	github.com/pjunak/ttrpg-codex v0.0.0
)

require (
	github.com/Masterminds/semver/v3 v3.5.0 // indirect
	github.com/santhosh-tekuri/jsonschema/v6 v6.0.3 // indirect
	golang.org/x/text v0.41.0 // indirect
)

// The published engine go.mod still names the host as v0.0.0. Drop this
// replace after requiring an engine commit that names a real host version.
replace github.com/pjunak/ttrpg-codex v0.0.0 => github.com/pjunak/ttrpg-codex v0.0.0-20261002110254-8463f4aa1e38
