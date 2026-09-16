# D&D Character Sheets

The workspace has **Sheet**, **Combat**, **Spells**, **Builder** and **Tools**
tabs in a vertical left rail, with Builder and Tools at the bottom. Compact and Classic layouts share one engine-calculated
character. Authorized editors can change inventory, equipment, currency, HP,
resources and spells directly in their tabs. Character notes belong to the core
profile; the sheet has no Notes tab or notes section in print.

Common fields, searchable choices, actions, tabs and modal focus use the host's
required `ui.controls.v1` [shared UI contract](../ttrpg-codex/docs/rewrite/UI_FOUNDATIONS.md).
The host supplies interaction and theme tokens; this package retains build/play
semantics and automatic saving.

Valid changes save automatically. Build completion is separate from validity:
an unfinished character is saved as it is built, while rules-dependent play
requires outstanding choices to be completed. There are no device drafts,
manual save buttons, revision history, undo or restore commands.

Builder separates **Character**, **Levels**, one tab per selected class, and
**DM given**. Progress starts expanded in a left sidebar; narrow layouts stack
it above the form.
Use **+** to add an eligible class and the class tab to add or remove levels.
Point buy and granted ability increases show live used/remaining budgets with
bounded steppers. Searchable dropdowns display descriptions while browsing and
accept only offered options. The engine supplies class and feat eligibility;
duplicate granted selections are excluded.

**Tools** owns export, reviewed replacement import, printing, layout and rules
status. Transfers use `dnd-character.v1` / schema 4.0.0 and contain the current
character only. Changed installed rules require explicit adoption. Without
compatible rules, saved values, export and printing remain usable.

The sheet is limited to 1,120 px and has no duplicate character heading. Compact
uses tighter ability cards and places currency directly below inventory.

The host owns the core profile, portrait and relationships. The native worker
provides `dnd5e.character` 2.0.0 and is the only writer of the `dnd-sheets`
schema-4 extension. Its `workerOnly` declaration preserves authorization without
retaining character snapshots. Install the compatible updated host before this
package. Existing schema-4 characters keep their inputs and saved projection.

Autosave serializes requests and rebases disjoint concurrent edits. Conflicting
edits and failed requests remain visible in the open page; pending input is not
stored in browser storage. The host's pending-edit guard protects navigation.
DM grants remain authenticated; amending or removing a grant changes its current
entry. Ordered levels and mechanics-required spell acquisitions are character
facts rather than a log of edits.

English and Czech catalogs cover controls; source prose and authored notes keep
their original language. See [save semantics](docs/RULES_EDGE_CASES.md), the
engine's [public contract](../addon-dnd-engine/contract/README.md), and the
[character workflow](../ttrpg-codex/docs/rewrite/CHARACTER_BUILD_HISTORY.md).

## Code ownership

- `internal/character`: authentication, evaluation, current writes and import review.
- `src/character-client.ts`: service calls, current transfers and conflict merging.
- `src/character-element.ts`: autosave queue and workspace lifetime.
- `src/character-build.ts` and `character-builder-nav.ts`: Builder controls and tabs.
- `src/character-sheet.ts`: direct play controls and calculated display.
- Go types generate schemas; the owning build generates web assets and locales.

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
tabs, engine-owned score values, automatic equipment saves, current-state persistence
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
