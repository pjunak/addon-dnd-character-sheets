# Character building and play

The host owns profiles, portraits and campaign relationships. Character Sheets
adds a rules-calculated workspace. Compact uses a six-tab layout:
Sheet, Combat, Equipment, Spells, Builder and Tools in a left rail. Tools sits
at the bottom, with Builder just above it. Compact fits up to 1,360 px within the
host article; Classic retains its 1,120 px, five-tab arrangement. Compact places
attributes/skills on the right and inventory/currency in Equipment. The host
character heading is not repeated. When
space is too narrow relative to text size, the vertical navigation stacks above
the sheet so enlarged text and recovery controls remain readable.

The Compact desktop frame measures every tab and current Builder section before
first visits, reusing that height during navigation and growing for expanded
content. Width, font and saved-data changes refresh the measurements. Temporary
inert samples borrow the same host controls and are removed immediately; they
cannot edit saved data or resolve rule links. The visible panel stays mounted
during resize, preserving focus and native input state. Narrow screens use normal
document flow.

Both Combat layouts share saved condition controls, source-defined levels and
condition details. Speed includes supported restrictions; the separate D20
adjustment applies once to rolls and does not change printed bonuses or spell
save DCs. Recalculation and rest preserve tracked conditions. Their source
summaries, levels and adjustments remain readable in saved print/export without
rules. The [Sheets contract](RULES_EDGE_CASES.md#authored-conditions)
owns persistence and the remaining table-adjudication boundary.

<a id="character-model"></a>
<a id="f16-f19-and-f20-first-complete-play-slice"></a>
<a id="f18-rules-details-everywhere"></a>

## Building a character over a campaign

The Builder is the character's ordered progression. Character contains origin,
base abilities and origin choices. Compact puts Origin before ability scores.
Classic retains a separate Levels view. Each class
has its own tab for its levels and granted choices; the + tab offers additional
classes allowed by the rules. Earlier decisions can be changed later. DM given
has its own Builder tab. Progress starts expanded on the left; narrow screens
stack it above the form to preserve usable control widths.

All legal changes save automatically, including an unfinished build. Completion
is a separate rules gate for dependent play actions. Point-buy and granted
ability budgets show used and remaining points immediately; steppers enforce
bounds. Searchable dropdowns offer rule-eligible choices, exclude duplicate
selections and show nonblocking descriptions while browsing.

Changing an origin or level recalculates dependent results. Previously granted
choices withdrawn by that edit are removed; illegal new selections are rejected.
Reducing maximum HP clamps current HP; raising it does not heal. Other authored
play state is preserved. Sheet and Combat share an authored Inspiration checkbox,
with automatic saving even for legal unfinished builds. Rest and recalculation
preserve it; saved print/export includes its current availability. Quick use
pins owned inventory entries in a shared Sheet/Combat panel. Use one spends the
actual quantity through an atomic worker command, without applying item effects.
Stored/depleted entries and their pins survive; unpinning keeps inventory,
while deleting an entry also removes its pin. Print/export retains those values.
Named storage containers group carried/stored instances, including depleted
entries. The Backpack editor creates, renames and removes groups; inventory and
the existing item picker share destination options. Removing a group keeps its
items, and equipping explicitly clears membership. These groups add no physical
items or carrying-capacity rules. Their names and contents remain readable in
saved output and print without a rules provider. Compact's Equipment tab opens
Backpack as a floating dialog with search, compartment filtering and sorting.
The shared item picker preserves that context on return. New instances are the
default; explicitly selecting an existing carried stack changes only its
quantity. All five coin fields stay at the bottom of Equipment.

Body placement is an optional per-instance assignment in inventory, using live
Engine source options and the shared native field. It adds no mechanical slots
or bonuses. Stowing, zero quantity and final-unit consumption clear placement
atomically; ordinary stowing preserves attunement. Old characters gain no
default assignments, and saved display, print/export and replacement imports
retain the field without a provider. The mannequin exposes ten placements with
source-backed candidates; Other worn is a dynamic list. Mechanical equipment
controls remain separate from display placement.

Sheet and Combat share owned main/off-hand selectors and a two-handed grip
toggle. Eligibility and effects come from the Engine; Combat also shows saved
attack/damage details. Two-handing temporarily carries the exact off-hand item
and suppresses its active equipment effects while preserving attunement. It
stays visibly suspended. Releasing the grip restores only an unchanged and still
eligible instance; otherwise the hand stays free with an explanation. Reload,
provider-free reading, print and transfer preserve those identities. No turn or
action costs are tracked. The controls use shared host fields, button styling,
focus keys and saved-rule details in both layouts.

Compact shares the same HP/AC/Speed/Proficiency/Inspiration geometry on Sheet
and Combat. Current HP is directly rewritable; a short bar supplements the
number. Temporary HP remains editable. Combat shows only ability modifiers and
saves in its small ability row, with distinct casting sources in the reference
panel. Additional attacks, rest/recovery, training, senses, feats and traits
remain accessible through disclosures.

Inventory,
equipment, currency, HP, spells and resources remain editable in their ordinary
tabs, without an edit-mode toggle. Character notes belong to the host profile and have no sheet tab or printed sheet section.
Existing saved notes remain in the compatible stored schema and transfers.

<a id="transfer-and-printing"></a>
<a id="authoritative-mutation-path"></a>

## Saving and transfer

There are no character history, undo, restore, draft, or manual save controls.
The native worker provides `dnd5e.character` 2.0.0 and writes only current
schema-4 state. The host's `workerOnly` extension policy keeps browsers from
bypassing authenticated commands without retaining snapshots.

The engine remains stateless. `guidance.canSave` distinguishes a legal incomplete
build from an illegal value; `guidance.saveIssues` explains actual save blockers
without listing every unfinished choice. `ready` requires completion for play. Source
identity, saved projections and evidence remain explicit. DM grants require the
current DM's authority, and amendments/revocations replace/remove the current
grant instead of accumulating superseded entries.

Autosave coalesces input and serializes writes. Disjoint concurrent fields can
merge; overlapping edits stay pending with a visible conflict. Rejected values
stay editable with their save blockers. Save feedback and retry actions remain
inside the active inventory/picker dialog when one is open, so the modal never
hides recovery controls. Retry reuses the exact uncertain request
before submitting newer edits, and Reload asks before discarding pending input.
Network failures never claim a successful save. Pending input stays in the open
page and the host navigation guard remains active until it is saved or explicitly
discarded. No device draft is written.

If a play action, DM grant or approved import loses its reply, further changes
pause and the same navigation guard stays active. Retry sends the exact action
again without duplicating its saved effect; imports keep their original approved
review. **Check saved character** asks before ending the retry, then reloads the
saved result without undoing any action. A failed check keeps recovery available.
When the rules refuse an action, nothing is saved and editing continues: the
action's button is outlined in red with an **Against the rules** note whose
reason shows on hover or keyboard focus, and the save status repeats the reason.
A save blocked by the rules marks the affected sheet sections the same way.
When another editor has already changed the character, the sheet reloads the
saved character; repeat the action if it is still needed. Commands do not merge
automatically.
A retry receipt can confirm the saved action without returning an evaluation.
In that case, **Saved** confirms persistence while a separate read restores
current play guidance; mechanical controls stay disabled until it arrives.

Empty inventory cannot remain equipped or attuned. Setting quantity to zero in
Sheets moves equipped items to carried and clears attunement in the same save.
The Engine owns eligibility, including active DM mechanics and grant expiry.
New attunement selections require equipped items. Existing carried/stored
allocations stay visible, count toward capacity, and survive ordinary moves.
**Stow & unattune** moves the same instance to Stored and releases its allocation
in one autosave; it preserves quantity, provenance, grants and notes.

Tools contains the only export option, plus reviewed import, printing, layout,
and rules status. A transfer contains the current character only. Import
requires exact replacement confirmation and reauthorization of imported DM
grants; their acquired choices, spells, spent counters and item links retain the
same values under fresh authenticated identities. File and paste use the same
limits, with correctable local errors kept inside the dialog. Print uses the
saved projection and includes origin, class/level and currency by default.

Without compatible rules, saved values, printing and export remain usable.
Changed rules require explicit adoption in Tools before mechanical edits. When
an autosave discovers the change, **Review changed rules** opens that action
without discarding the pending input. **Adopt rules and save pending changes**
saves both deliberately, using the opening revision; another editor's changes
still produce a conflict. A successful acknowledgment re-enables editing, and
a lost acknowledgment retries the exact adoption rather than a fresh save.

<a id="implementation-sequence-and-ownership"></a>
<a id="verification-result"></a>

## Installation and validation

Install the host with worker-only extension and compatible schema-review support
before the updated sheet ZIP. The permanent namespace and schema version remain
unchanged, but the optional authored play fields change the closed schema hash. Materialized
installations use the host's guided update confirmation and **Heal and update**
for the inspected package. The host preserves existing JSON and character
revisions without adding defaults, and handles runtime restart automatically. See the
[owning upgrade contract](RULES_EDGE_CASES.md#inspiration-and-compatible-schema-upgrades).
Existing archived snapshots and prior installation backups are not erased,
exposed by the character service, or extended by new character saves.

See the [sheet save contract](RULES_EDGE_CASES.md) and the Engine's
[service contract](https://github.com/pjunak/addon-dnd-engine/blob/main/contract/README.md).
This repository's tests cover the worker coordinator, saving, transfer and
inventory rules. The host's installed add-on smoke test installs the real
package with the Engine and Compendium, then builds a character from a blank
sheet, saves it automatically, plays, transfers and prints it.
