# D&D Character Sheets

`dnd-sheets` adds a reversible character workspace beneath the host-owned
profile. **Play**, **Build** and **History** share the same saved decisions,
calculated projection and source explanations. Compact and Classic are layout
preferences. The interface has English and Czech catalogs; authored source
names, rule prose and character notes keep their source language.

## Character workflow

Build records origin, abilities, ordered class levels, choices, spells, inventory
and notes. A preview shows invalidated choices and resulting changes before a
new revision is saved. The native worker authenticates commands and stores
retained revisions through the host's history capability. Browsers cannot write
the character extension directly.

Play offers bounded HP, temporary HP, resources, currency, rest, recorded hit
dice, activations, casting and copying. DM rewards, feats and typed exceptions
carry the authenticated DM, reason, effective level and optional condition or
expiry. Amendments retain the prior grant and record a replacement. Reusable
homebrew uses compatible versioned source add-ons.

History can inspect, compare, export and print saved revisions. Restoration
appends a revision. Build-only restoration preserves current play, notes and
paid spell acquisitions; play and complete restoration are explicit alternatives.
Undo uses a reviewed complete restoration of the previous revision.

Drafts survive reload and failed saves on the same device/browser/origin/editor.
Concurrent changes preserve the draft for comparison and explicit rebase.
JSON export/import uses only `dnd-character.v1` / schema 4.0.0. File and paste
share parsing and exact replacement review. Imported DM grants need a current
DM's approval; imported roll/acquisition provenance is labeled as external.
Print/PDF always uses a selected saved revision, with optional long sections and
source/build details. Browser printing supports A4 and Letter.

The optional `dnd5e.rules-engine` ^4.0.0 provider supplies all calculations.
Without compatible rules, existing revisions, history, notes, printing and export
remain usable. Mechanical edits require compatible rules. A changed engine,
book policy or source package requires explicit review/adoption before play.

## Contracts and ownership

- Public character service: `dnd5e.character` 1.0.0, native-worker transport.
- Permanent extension ID: `dnd-sheets`, schema 4.0.0, retained.
- `internal/character`: authenticated review/commit and persistence coordination.
- `src/character-client.ts`: browser service, transfer and local draft boundary.
- `src/character-element.ts`: workspace composition and asynchronous lifetime.
- Shared Build, Play, grant, comparison and projection renderers under `src/`.
- Generated schemas and TypeScript types come from Go contract types; catalogs
  compile from `locales/en.json` and `locales/cs.json`.

See [failure and restore semantics](docs/RULES_EDGE_CASES.md), the engine's
[public contract](../addon-dnd-engine/contract/README.md), and the host's
[retirement procedure](../ttrpg-codex/docs/rewrite/CHARACTER_SHEET_CUTOVER.md).
The old hand-filled sheet format and engine handlers are retired.

## Development

Use the declared Node toolchain and Go 1.27.1:

```text
npm run check
npm run package
```

Inspect the resulting ZIP from the host with
`go run ./cmd/codex-addon-inspect ../addon-dnd-character-sheets/dist/dnd-sheets-4.0.0.zip`.
The package includes generated web assets and native workers. Source checkout
edits become visible only after rebuilding and reviewed activation. Current
integration tests live in the host's installed character/rules/sheets suites.
