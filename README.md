# D&D Character Sheets

Compact follows the final character-sheet mockup: **Sheet**, **Combat**,
**Equipment**, **Spells**, **Builder** and **Tools** sit in a left rail, with
Builder immediately above Tools at the bottom. Its frame fits up to 1,360 px
inside the host article. Classic retains its existing five-tab arrangement.
Both layouts share one engine-calculated
character. Authorized editors can change inventory, equipment, currency, HP,
resources and spells directly in their tabs. Sheet and Combat share an
**Inspiration** checkbox that saves the authored allocation automatically,
including for legal unfinished builds. Saved print/export keeps the value;
rest and recalculation do not award or spend it. New attunements select equipped
items; existing carried/stored attunements remain visible and count toward
capacity. **Stow & unattune** moves an item to Stored and releases its allocation
in one automatic save. Ordinary moves preserve attunement.
**Quick use** pins existing inventory entries in a shared Sheet/Combat panel.
**Use one** spends from the real quantity without applying item effects.
Stored/depleted pins and item notes stay visible; unpinning keeps the item,
and deleting an item removes its pin in the same save.
**Storage containers** organize carried/stored inventory into named groups.
Create, rename or remove a group and choose destinations in inventory or the
item picker. Removing a container leaves its items intact; equipping an item
clears only its membership. Organization adds no items or carrying-capacity
rules, and saved reading, print and export retain it without a provider.
**Body placement** organizes equipped instances using Engine-provided source
choices. It does not add bonuses or equipment limits. Ordinary stowing clears
placement while preserving the item and its attunement; saved reading, print
and export retain assigned placements without a provider.
**Hands and grip** shares owned-item selectors and a two-handed toggle between
Sheet and Combat. The Engine supplies eligibility, damage and equipment effects.
Two-handing temporarily carries the exact off-hand item without releasing its
attunement; releasing the grip restores it only when unchanged and still eligible.
Changed or missing items leave the hand free with an explanation. Combat shows
saved attack/damage details; Sheet omits those numbers. Saved reading, print and
transfer retain the selected and suspended identities without a provider.
Character notes belong to the core
profile; the sheet has no Notes tab or notes section in print.

Common fields, searchable choices, actions, tabs and modal focus use the host's
required `ui.controls.v1` [shared UI contract](../ttrpg-codex/docs/reference/UI_FOUNDATIONS.md).
The host supplies interaction and theme tokens; this package retains build/play
semantics and automatic saving.

Each Compact tab opens with a context bar holding only what that tab needs.
Sheet and Combat share HP, temporary HP, AC, Speed, Proficiency and Inspiration;
Combat adds Initiative. The HP field takes a value or `-7` (damage), `+5`
(healing) or `=30` (set) followed by Enter; damage and healing go through the
rules. A status row lists conditions with their levels and remove buttons, the
separate D20 adjustment and Short/Long rest. Equipment shows AC, Speed and
attunement; Spells shows casting numbers, spell-slot pips and **Change prepared
spells**. Compact puts abilities and skills on the right, starting at the top;
untrained skills are dimmed. **Limited uses** shows remaining uses as pips (a bar
with steps for large pools) and each resource's short/long rest recharge. Combat
keeps its attack list open, with casting sources beneath. Spell rows show casting
time, range, concentration and ritual from the source record.

Bigger editors open as floating windows: Backpack, the body figure, rests and
prepared spells. Windows are not modal; the sheet stays usable behind them, the
header moves them, the corner resizes them and Escape closes them. Their
position is a view preference for the open character, not saved data. A rest
window lists what each resource's recharge declares, offers hit-die spending on
a short rest and applies the rest only when finished; a refused rest stays open
beside its rule note.

**Equipment** lists what is worn and held with Stow actions, the empty body
places, mechanical equipment controls and all five currency denominations, with
the Backpack summary at full height beside them. The source-filtered body figure
opens in its window from a place or **Open figure**. **Backpack** opens a
searchable, sortable window with container filtering. Add Item returns to that same search
and compartment; it defaults to a new instance and offers explicit addition to
a carried stack. Existing item names, notes, grants and equipped copies survive.
The shared Add Item picker groups armor by its declared armor type, magic items
by their source item type and weapons by their source category. Unclassified
gear stays under Other; browse grouping never grants equipment eligibility.
Save feedback and retry actions move into the active dialog. Advanced mechanical
armor/shield/worn controls remain available separately from body placement.
Closing a dialog restores its return control when needed; delayed cleanup keeps
focus on another control if the user has already moved there.

The desktop frame measures every tab and current Builder section before the
first visit, then reuses that height during navigation. Width, font and saved-data
changes refresh the measurements; expanding content can grow the frame. Temporary
inert samples use the same shared controls, cannot edit data or resolve rule links,
and are removed after measurement. Only the selected editable view stays mounted.
Small screens use normal document flow, with no retained desktop minimum height.
Compact navigation wraps whole labels into rows as space or text size changes.
It uses the host's tab controls: Up/Down for the desktop rail, Left/Right for
the narrow-screen rows, with the same selected tab and keyboard focus.

**Conditions** use the Compact status row or the Classic Combat panel. Select a
condition, adjust its source-defined level or remove it; changes save
automatically. Speed includes supported condition restrictions. A separate D20
roll adjustment is shown explicitly and is not folded into the displayed
bonuses or spell save DCs. Condition summaries survive provider loss, print and
export. End conditions explicitly, including after a rest; situational effects,
concentration, dropped items and death remain table decisions.

Valid changes save automatically. Build completion is separate from validity:
an unfinished character is saved as it is built, while rules-dependent play
requires outstanding choices to be completed. There are no device drafts,
manual save buttons, revision history, undo or restore commands.

Compact Builder separates **Character**, one tab per selected class, spell
choices and **DM given**. Add/remove levels in the owning class; their global
order and acquisition IDs remain unchanged. Compact repair links select the
owning class instead of a standalone Levels tab. Classic retains Levels.
Progress starts expanded in a left sidebar; narrow layouts stack
it above the form.
Use **+** to add an eligible class and the class tab to add or remove levels.
Point buy and granted ability increases show live used/remaining budgets with
bounded steppers. Searchable dropdowns display descriptions while browsing and
accept only offered options. The engine supplies class and feat eligibility;
duplicate granted selections are excluded. Spell selectors in Builder,
**Change prepared spells** (Compact) and **Manage spells** (Classic) share the same controls. Selecting or preparing spells preserves
keyboard focus, expanded groups and search/level filters through automatic saves
and tab changes. These view preferences belong to the open character, not its
saved rules state.

Combat and print share readable proficiency groups, including separate Expertise,
trained saving throws, equipment training and languages. Saved source details
remain usable without a rules provider; missing data stays distinct from an
empty group. Saving-throw shields show and name their saved training state.

**Tools** owns export, reviewed replacement import, printing, layout and rules
status. Transfers use `dnd-character.v1` / schema 4.0.0 and contain the current
character only. Changed installed rules require explicit adoption. If an
autosave discovers changed rules, **Review changed rules** opens Tools; explicit
adoption can save the pending edits together with the new rules. Conflicts and
uncertain requests retain their recovery guards. Without compatible rules,
saved values, export and printing remain usable.

The sheet is limited to 1,120 px and has no duplicate character heading. Compact
uses tighter ability cards and places currency directly below inventory. When
enlarged text leaves too little room beside navigation, the rail stacks above
the sheet and keeps its vertical keyboard behavior. Ability cards stack their
score and skill list when the available width would squeeze enlarged skill
names into narrow columns.

The host owns the core profile, portrait and relationships. The native worker
provides `dnd5e.character` 2.0.0 and is the only writer of the `dnd-sheets`
schema-4 extension. Its `workerOnly` declaration preserves authorization without
retaining character snapshots. Install the compatible updated host before this
package. The optional Inspiration, quick-use, storage, body-placement and hand fields change the stored schema hash, so
materialized installations need the host's [compatible schema review](docs/RULES_EDGE_CASES.md#inspiration-and-compatible-schema-upgrades)
before activation. Existing schema-4 characters keep their exact inputs and
saved projection; no reset or value conversion is required.

Autosave serializes requests and rebases disjoint concurrent edits. Rejected
edits stay on the page with a reason; Retry confirms an uncertain save before
sending newer changes. Reload asks before discarding pending edits. The host's
pending-edit guard protects navigation, but input is not stored in browser
storage and closing the page can lose unsaved changes.
DM grants remain authenticated; amending or removing a grant changes its current
entry. Ordered levels and mechanics-required spell acquisitions are character
facts rather than a log of edits.

English and Czech catalogs cover controls and known save/recovery explanations.
Source prose, authored values and unknown provider diagnostics keep their original
wording. See [save semantics](docs/RULES_EDGE_CASES.md), the
engine's [public contract](../addon-dnd-engine/contract/README.md), and the
[character workflow](docs/WORKFLOW.md).

## Code ownership

- `internal/character`: authentication, evaluation, current writes and import review.
- `src/character-client.ts`: service calls, current transfers and conflict merging.
- `src/character-element.ts`: autosave queue and workspace lifetime.
- `src/character-build.ts` and `character-builder-nav.ts`: Builder controls and tabs.
- `src/character-sheet.ts`: direct play controls and calculated display.
- Go types generate schemas; the owning build generates web assets and locales.

## Development

Use Node.js 26 (`.nvmrc`) and the Go version in [go.mod](go.mod). The repository
builds from a plain clone: the host's worker SDK and the Engine's public
`character` model are ordinary Go module requirements (a build dependency only;
no engine is needed at runtime). To develop against unreleased host or Engine
changes, run `go work init . ../ttrpg-codex ../addon-dnd-engine` (the `go.work`
file is ignored).

```text
npm ci
npm run check:fast
npm run check
npm run package
```

`check:fast` rejects authored JavaScript, type-checks browser source, tools and
tests, runs typed Oxlint and Prettier checks, and performs the fast Go checks.
Use `npm run typecheck`, `npm run lint`, `npm run lint:fix`, `npm run format` or
`npm run format:check` for a focused iteration. Generated schemas, models,
catalogs and package output stay under their owning generators and are excluded
from source formatting and linting.
Browser source and Node tools/tests have separate typed-lint passes. CI and
weekly maintenance also run `npm run check:dependencies` against the npm lockfile;
high or critical advisories fail this network check without applying fixes.
Use `npm run check:workflows` and `npm run check:vulnerabilities` to run the
matching workflow and reachable Go vulnerability checks locally.

Inspect the resulting ZIP with the host's inspector:
`go tool -modfile=go.tools.mod codex-addon-inspect dist/dnd-sheets-4.2.0.zip`.
The package command rebuilds web assets and native workers from source, including
when neither output directory exists. `web/`, `worker/` and `dist/` are ignored
build artifacts; public schemas and generated TypeScript models remain versioned.
CI checks that builds preserve tracked source. Tests type-check against `src/`
and import freshly built `web/` at runtime through `npm run check`; `npm test` is
a focused rerun after building. The source guard rejects tracked or untracked,
non-ignored JavaScript source while allowing ignored compiled output. Source checkout
edits become visible only after rebuilding and reviewed activation. The host's
installed add-on smoke test installs this package with the Engine and Compendium
and builds, saves, transfers and prints a character.


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
