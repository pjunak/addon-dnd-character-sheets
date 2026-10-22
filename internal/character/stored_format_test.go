package character

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	model "github.com/pjunak/addon-dnd-engine/character"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

// storedFormats pins every released stored format: the digest of its schema
// (model.Schema(State{})) and, when it has one, of its frozen sheet fixture in
// testdata/sheet-state-<version>.json. Neither may change. A change to the
// stored types needs a new SchemaVersion, an upgrade from the old format and
// a new row; see docs/RULES_EDGE_CASES.md#changing-the-stored-format.
var storedFormats = map[string]struct{ schema, fixture string }{
	"5.0.0": {
		schema:  "e707ccfaa982a1da641924f08bc640ab3d3ea2812081cfd5159a37d82cb33e87",
		fixture: "4d072fbd143e059255515063e5ce9d93c9bab8c7b51fa7f85c2435d524387f8a",
	},
	"6.0.0": {schema: "3e12c7b8ae26aac0dd2271497ed66289013a2547be3df646978ca4c34045e457"},
	"6.1.0": {schema: "4b25552edc8f517cb27828244bf2495409f9f39115d2b007d8df8a60304938bd"},
}

// digest hashes a JSON value independently of its formatting.
func digest(t *testing.T, body []byte) string {
	t.Helper()
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		t.Fatal(err)
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:])
}

func TestStoredSchemaChangesNeedANewVersion(t *testing.T) {
	current := digest(t, raw(model.Schema(State{})))
	format, released := storedFormats[SchemaVersion]
	if !released {
		t.Fatalf("stored format %s has no row in storedFormats; its schema digest is %s", SchemaVersion, current)
	}
	if current != format.schema {
		t.Fatalf("the stored schema changed, but SchemaVersion is still %s. Bump SchemaVersion and the manifest's schemaVersion, freeze the old schema and register its upgrade (docs/RULES_EDGE_CASES.md#changing-the-stored-format), then add a row for the new format; its schema digest is %s", SchemaVersion, current)
	}
	// Older formats this release upgrades keep their exact released schema.
	for _, version := range LegacySchemaVersions() {
		body, err := os.ReadFile(filepath.Join("..", "..", "contracts", "legacy", "sheet-state-"+version+".schema.json"))
		if err != nil {
			t.Fatal(err)
		}
		if format, released := storedFormats[version]; !released || digest(t, body) != format.schema {
			t.Fatalf("contracts/legacy/sheet-state-%s.schema.json is not the released %s schema", version, version)
		}
	}
	// The host tracks stored-format changes by the manifest's schemaVersion.
	body, err := os.ReadFile(filepath.Join("..", "..", "addon.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		RecordExtensions []struct {
			DataID        string `json:"id"`
			SchemaVersion string `json:"schemaVersion"`
		} `json:"recordExtensions"`
	}
	if err := json.Unmarshal(body, &manifest); err != nil {
		t.Fatal(err)
	}
	for _, extension := range manifest.RecordExtensions {
		if extension.DataID == reference.DataID && extension.SchemaVersion != SchemaVersion {
			t.Fatalf("addon.json declares schemaVersion %s for %s, the worker writes %s", extension.SchemaVersion, reference.DataID, SchemaVersion)
		}
	}
}

func TestFrozenSheetsStillLoad(t *testing.T) {
	// Validate as the host does before every write of a saved sheet.
	body, err := os.ReadFile(filepath.Join("..", "..", "contracts", "sheet-state.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	document, err := jsonschema.UnmarshalJSON(bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	compiler := jsonschema.NewCompiler()
	compiler.DefaultDraft(jsonschema.Draft2020)
	compiler.AssertFormat()
	if err := compiler.AddResource("file:///addon/contracts/sheet-state.schema.json", document); err != nil {
		t.Fatal(err)
	}
	schema, err := compiler.Compile("file:///addon/contracts/sheet-state.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	validate := func(name string, body []byte) {
		t.Helper()
		value, err := jsonschema.UnmarshalJSON(bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if err := schema.Validate(value); err != nil {
			t.Fatalf("%s does not match contracts/sheet-state.schema.json: %v", name, err)
		}
	}
	for version, format := range storedFormats {
		if format.fixture == "" {
			continue
		}
		name := "testdata/sheet-state-" + version + ".json"
		t.Run(version, func(t *testing.T) {
			body, err := os.ReadFile(filepath.FromSlash(name))
			if err != nil {
				t.Fatal(err)
			}
			if got := digest(t, body); got != format.fixture {
				t.Fatalf("%s is frozen, but its digest is now %s. Restore it; test a changed format with an upgrade instead", name, got)
			}
			validate(name, body)
			state, err := decodeState(body)
			if err != nil {
				t.Fatalf("%s no longer loads: %v", name, err)
			}
			if state.SchemaVersion != SchemaVersion || len(state.Inputs.Play.Inventory) == 0 || state.Projection.Sheet.Calculation == nil {
				t.Fatalf("%s loaded incompletely: version %s", name, state.SchemaVersion)
			}
			// The upgraded sheet is what this release would save.
			validate(name+" after loading", raw(state))
		})
	}
	fixtures, err := filepath.Glob(filepath.Join("testdata", "sheet-state-*.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range fixtures {
		version := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(path), "sheet-state-"), ".json")
		if storedFormats[version].fixture == "" {
			t.Fatalf("%s has no fixture digest in storedFormats", path)
		}
	}
}
