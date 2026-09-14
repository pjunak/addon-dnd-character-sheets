# D&D Character Sheets

`dnd-sheets` restores the character workspace alongside the host-owned profile.
**Sheet** and **Combat** use the Compact/Classic ability-card rail, vitals strip,
worn equipment and split backpack. **Spells** and **Notes** have their own tabs;
**Builder** restores the progress rail, Character/class navigation and level
choices. **History** retains the new revision workflow, and **Tools** contains
layout preferences, rules status, import, export and printing.

**Edit sheet** enables inventory, equipment, currency and resource edits. The
equipment picker has searchable folders and a quantity tray; adding items keeps
them in the draft until reviewed. Calculated scores, saves and skills come from
the saved engine projection, with linked explanations. HP, spell and rest actions
still use the worker-owned review/commit path. Previous per-character
Compact/Classic preferences remain readable.

The interface has English and Czech catalogs; authored source names, rule prose
and character notes keep their source language.

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
- `src/character-sheet.ts`: ability cards, vitals, backpack and combat display.
- `src/character-builder-nav.ts` and `character-build.ts`: guided Builder and level choices.
- `src/character-equipment.ts`: folder picker and quantity tray.
- Shared spell, grant, comparison and saved-projection renderers under `src/`.
- Generated schemas and TypeScript types come from Go contract types; catalogs
  compile from `locales/en.json` and `locales/cs.json`.

See [failure and restore semantics](docs/RULES_EDGE_CASES.md), the engine's
[public contract](../addon-dnd-engine/contract/README.md), and the host's
[retirement procedure](../ttrpg-codex/docs/rewrite/CHARACTER_SHEET_CUTOVER.md).
The package owns both layouts; there is no external renderer service.
The old hand-filled format is retired. See the
[character workflow](../ttrpg-codex/docs/rewrite/CHARACTER_BUILD_HISTORY.md) for
a step-by-step explanation of revisions and rules changes.

## Development

Use Node.js 26 and the Go version in [go.mod](go.mod). Its local module
replacements expect compatible `ttrpg-codex` and `addon-dnd-engine` checkouts
beside this repository. This build dependency does not require an installed
engine at runtime.

```text
npm ci
npm run check
npm run package
```

Inspect the resulting ZIP from the host with
`go run ./cmd/codex-addon-inspect ../addon-dnd-character-sheets/dist/dnd-sheets-4.0.0.zip`.
The package includes generated web assets and native workers. Source checkout
edits become visible only after rebuilding and reviewed activation. Current
integration tests live in the host's installed character/rules/sheets suites.
The installed-character suite checks both layouts on desktop and phone, keyboard
tabs, engine-owned score values, reviewed equipment changes, retained revisions
and provider-absence behavior.


## Install and update from tested commits

Successful main builds publish the inspected ZIP to a permanent
[commit release](https://github.com/pjunak/addon-dnd-character-sheets/releases). Each release identifies
the source commit even when the package version is unchanged. CI uses GitHub's
automatic repository token; it does not deploy to anyone's server.

In your website, open **Settings → Add-ons → Add add-on → GitHub**, enter
`pjunak/addon-dnd-character-sheets` and use **Latest published package**. For an installed ZIP, use
**Update source** to link the same repository. **Check for updates** offers the
latest tested package; **Download and review** leads to explicit permission and
compatibility review before **Approve and activate**. Publishing never forces
an update on an installation.

Public release downloads do not require a GitHub token.

Existing Actions-build sources remain supported, but their artifacts expire.
Switch an existing source to **Latest published package** to use durable releases.
