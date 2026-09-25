# Character saves and failure semantics

The coordinator owns the current `dnd-sheets` extension for each core character
lifetime. Schema 4.0.0 accepts earlier characters and the optional authored
Inspiration, quick-use and storage fields; installing a changed schema requires the review below. The core profile, portrait and relationships are host-owned.

## Inspiration and compatible schema upgrades

`inputs.play.inspiration` is an optional boolean. Absent means unavailable
without adding a value to an existing character; explicit false records spending
it. Sheet and Combat share one labelled native checkbox and automatic-save path.
Editing requires `guidance.authoredPlay.inspiration: true` from the selected
Engine. It also works for legal unfinished builds. Recalculation, rest and other
play operations preserve the value; no automatic awards or dice rerolls occur.

The worker rejects an Engine result that drops or changes authored Inspiration.
Older providers that reject the new input leave the saved character readable;
provider-free display, print and export retain the allocation. Replacement
imports carry explicit false and true values through the ordinary review.
Concurrent disjoint fields may merge; conflicting explicit values remain pending.

The extension namespace and schema version stay `dnd-sheets` / `4.0.0`, but the
closed schema's hash changes. On a materialized installation, update the host
first, disable Sheets, then use **Review saved-data compatibility** for the
inspected new package. Apply that exact review, then review and activate the
package normally. The host checks every stored value and preserves its bytes,
document revision and recovery evidence. This is not an automatic converter or
a reset. These optional fields do not require rewriting current characters.
A package rollback after new values have been saved can require a separate
review and may be blocked if the old schema cannot represent them.

## Quick-use identity and consumption

`inputs.play.quickUse` optionally stores ordered inventory instance IDs.
Pinning works for legal unfinished builds when the Engine advertises
`guidance.authoredPlay.quickUse`. Using an item requires a ready character and
live `guidance.quickUse[id].canUse`. One shared panel serves Sheet and Combat;
native actions, stable focus keys and semantic tokens come from the host UI.

While an asynchronous play action disables controls, completion restores the
initiating control by its stable key if the browser lost focus. If the last unit
makes that action unavailable, focus moves to the next usable control in the
same item row. Focus deliberately moved outside the sheet is left alone.

Pins do not copy inventory or create a second quantity counter. `consume-item`
uses one carried/equipped unit through the worker's ordinary optimistic play
command. Empty entries and pins remain; the last equipped/attuned unit releases
that allocation atomically. Notes, acquisition, source and grant references
stay attached to the original instance. The action records consumption only;
item effects are resolved separately. Rests and recalculation never replenish it.
Stored/empty pins remain visible but cannot be used.

Unpinning preserves the item. Explicit inventory deletion removes that same
instance's pin in one autosave. Missing or duplicate references from other
clients/imports are rejected rather than silently repaired. Independent fields
can merge, competing pin lists conflict, and a merge against a remotely deleted
item remains pending for explicit unpinning; it cannot recreate the entry.

The coordinator rejects an Engine response that drops, reorders or substitutes
pins. Older/incompatible providers leave saved state readable. Print/export
preserve pin order and depleted entries; reviewed replacement import validates
references normally. Both pre-Inspiration and pre-quick-use schema-4 values pass
the compatible schema review with exact JSON bytes and revisions preserved.

## Storage identity and membership

Optional `inputs.play.containers` holds flat named groups; an item's optional
`containerId` refers to one group. These organize owned instances without
creating backpack items, changing carried/stored location or imposing capacity.
Names may repeat; IDs distinguish the groups. Equipped items cannot be assigned,
and explicit equipping removes the selected item's membership atomically.
Depleted entries, quick-use pins, grants, notes and existing attunement survive.

The shared Backpack editor creates, renames and removes containers and assigns
inventory entries. The existing item picker offers the same destination list
for catalog and narrative additions; additions remain separate instances.
Removing a group unassigns only its members without deleting inventory.
Native labelled fields/actions use `ui.controls.v1`, semantic tokens and stable
focus keys. The sheet renderer preserves keys assigned by reusable controls
and only generates fallback keys for unkeyed fields. Editing requires live `guidance.authoredPlay.storage`; counts and
labels remain readable without a provider, and print/export retain membership.

The worker rejects results that drop, rename, reorder or substitute groups or
change membership. Engine validation rejects dangling memberships, invalid names,
duplicate IDs and equipped assignments without normalization. Disjoint edits may
merge; competing container or inventory arrays conflict. A concurrent removal can
leave a merged assignment invalid: it remains pending for explicit unassignment,
never a silent recreation. Reviewed replacement import uses the same validation.
Optional fields preserve all three previous schema-4 generations through the
host's saved-data review, with no JSON or document-revision rewrite.

The final Equipment tab, searchable floating Backpack dialog, compartment
filter/sort and explicit existing-stack choice remain T63 work.

## Automatic saving

`dnd5e.character` 2.0.0 exposes `load`, `evaluate`, `save`, `preview` and `commit`
using `character.v2` / `character-response.v2`. History, revision lookup,
comparison and restoration are removed. Transfers contain the current character
only; there is no browser draft or frozen-import store.

The worker checks the current revision, authenticates grants, evaluates mechanics
and writes the latest inputs/projection through the host's ordinary transaction.
The extension declares `workerOnly: true` without retention or `data.history`.
Optimistic revision numbers and the last operation ID protect concurrency and
lost-response retries; they are not a browsable history. Normal host transaction
bookkeeping remains part of database integrity.

Ordinary saves return the accepted current state and evaluation without an
import-review comparison. This keeps a large successful write from failing its
response contract because of hundreds of generated statistic changes. Import
previews compare authored inputs, rules identity and calculated sheet values;
source evidence/explanations remain available in the projection. Large review
subtrees are grouped with complete before/after values within the existing
500-entry response bound. Approval still commits the exact retained proposal.

The engine's `guidance.canSave` permits legal incomplete builds. Its additive
`guidance.saveIssues` lists actual save blockers separately from unfinished
required choices. `ready` still requires all choices and mechanical bounds to
pass before play commands run.
Point buy, granted budgets, source choices and class prerequisites come from the
engine. UI controls prevent overspending and duplicate selections; server
validation also protects against stale or forged requests.

Changing an earlier origin or level, or amending/revoking a DM grant, removes only previously saved selections
that the Engine identifies as unavailable choices, ineligible options or slots
beyond the new choice count. Stable issue IDs identify the exact slot; valid
siblings and newly edited replacements survive. Dependent withdrawals settle
until no more saved selections are removed. Newly supplied illegal choices are
rejected, and other rule violations remain visible for deliberate repair. Lower maximum
HP clamps current HP; raising the maximum never heals. Other authored play state
is preserved unless explicitly changed. Amending/revoking a DM grant replaces or
removes its current entry, without retaining superseded grants.

The browser serializes and coalesces pending edits. Independent concurrent fields
can rebase automatically; overlapping fields/arrays remain pending with a visible
conflict. Rejected autosaves keep the input, show the Engine's save blockers and
retain the active text field/caret. A newer correction continues automatically
when an older rejected request finishes. Accepted choice withdrawals are merged
with later edits so withdrawn selections cannot silently return.

An uncertain autosave retains its exact operation ID, expected revision and
inputs for Retry. Newer edits wait for that request's acknowledgment before a
new save is sent. The worker recognizes its last accepted operation; if another
editor has since written, ordinary revision/conflict handling applies instead.
An acknowledgment without evaluation triggers a read to refresh guidance.
Reload requires explicit confirmation before discarding pending edits.

Direct play, grant/amend/revoke and rules-adoption commands also retain their
exact request after an uncertain response. Reviewed imports retain the approved
token, operation ID and expected revision; Retry never makes a new preview or
bypasses review. Further mutations and background refresh pause until the outcome
is resolved, and the host navigation guard remains active. A conflicting or
rejected response requires checking saved state before deciding what to do next;
commands never rebase automatically onto another editor's changes. An explicit
check ends the retry only after a successful load, without undoing a saved action.
Lost acknowledgments can be recognized across worker restarts from the last
accepted operation; older requests cannot overwrite a later revision.

Failed or uncertain writes do not claim success. Pending input stays in the open
page, with the host navigation guard, and is not durable until saved. Recovery
controls use the shared host UI and English/Czech messages. Reducing an inventory quantity to zero explicitly
moves an equipped item to carried and clears attunement in the same save; the
Engine independently rejects requests leaving empty equipment active.

## DM grant amendments

Grant proposals are detached from both the saved snapshot and supplied inputs.
An amendment retains its acquisition ID and list position; actor, reason and time
record the new authorization. Moving or removing the item binding clears only
links owned by that grant. Revocation also removes those links without changing
item quantities, locations, notes or other grants. Rejected or unavailable
amendments return the unchanged saved snapshot and never write a revision.

Create and amend share the same form. Effect rows retain their controls and
stable field identities as other rows change. Adding a row focuses its target;
removing one focuses the next row, previous row, or Add effect. Each group has
a wrapping heading with its full effect name, including on enlarged phone
layouts. Required fields use native form validation and keep incomplete input
in the dialog. Feat and item searches borrow host ui.controls.v1 comboboxes;
the Engine still owns mechanical validity.

Installed acceptance combines two separate Magic Initiate acquisitions and spent
free casts with effect changes, item rebinding, provider restart, explicit source
policy adoption and revocation. Each surviving acquisition keeps its choices,
casting ability and spent uses. A provider restart alone retains rules identity;
a policy change requires explicit adoption. Installed compatibility acceptance also
replaces the engine with an incompatible service major or response schema and
restores the exact original generation without losing spent casts. A sheet-schema
change is blocked before activation; worker-only writes and the exact schema-4
state remain protected, including in a portable backup. Broader combinations and
human assistive-technology acceptance remain in the host backlog.

## Class-granted choices and spell pickers

Class-granted feats and conditional spell alternatives use the same Engine-owned
Builder descriptors and spell pickers as other sources. Source lists, counts,
casting abilities and branch availability stay in the provider/Engine; Sheets
adds no class-specific controls. Changing a branch uses the existing exact-choice
and spell-grant withdrawal policy while preserving unrelated saved state.

The shared spell picker uses the existing wrapping control layout to separate
each checkbox label from its borrowed rule-details control. Builder and Manage
spells share this rendering and focus behavior, including enlarged phone views.

## Saved feat display

Combat details and print share the same feat renderer, borrowing the host's
rule-details control and reading the Engine's acquired `sheet.feats` identities
and counts. Summaries come from exact kind-and-ID matches in saved evidence.
Provider-free output never queries the catalog or infers an acquisition from
unrelated evidence. Older projections without this additive list remain readable;
a deliberate recalculation is needed to capture newly available output.

## Saved proficiency display

Combat and print use one renderer for saved saving-throw training, skills,
Expertise, armor, weapons, tools and languages. Only explicit trained values
appear; Expertise has its own group instead of duplicating a skill. Recorded
empty groups and missing saved data have distinct English/Czech messages.
Languages appear once in this summary.

The view formats Engine-owned category tokens and ability/skill labels. Equipment
and language records use names from exact kind-and-ID matches in saved evidence
when available; otherwise their saved text is made readable without a live
catalog lookup. Source names remain authored text. It never infers training from
a class, feat or source record and never writes a character revision.

Available explanations and saved references use the existing host rule-details
control, including provider-free reading and keyboard focus return. Saving-throw
markers use the same saved trained flag for their visible fill and accessible
name. Both layouts share these behaviors.

Native description lists associate training groups with their values; nested
unordered lists expose individual entries. The
[W3C content-structure guidance](https://www.w3.org/WAI/tutorials/page-structure/content/)
informs this grouping, and [reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
informs wrapping without fixed column counts. Installed acceptance covers
English Compact and Czech Classic at enlarged phone width, multiclass training,
DM proficiency withdrawal, provider restart, saved details, print and export.
Human screen-reader and physical printer acceptance remain separate.

## Service feedback

The shared save/recovery status translates known coordinator responses and
Engine blockers into the browser's English/Czech language. Numeric limits and
counts come from the returned message; presentation never calculates a rule or
changes the pending input, save outcome, revision or retry request.

The current service contract returns readable strings. `character-feedback.ts`
recognizes exact catalog entries and a bounded set of complete message templates.
It preserves captured IDs, grant names and source wording verbatim, including
literal placeholders. Unknown or changed wording remains intact as plain text,
so a new provider diagnostic cannot lose its specific reason or be mistaken for
a successful save. This applies to load failures, rejected autosaves, commands
and reviews through the existing shared controls; saved projections are unchanged.
When evaluation reports unavailable rules, loading uses the saved projection and
skips live catalog requests. A secondary catalog failure cannot overwrite the
worker's specific explanation.

An Engine blocker targeting pending HP keeps that numeric field available for
correction under the existing edit/rules permissions. Its stable shared focus
identity survives rejected and accepted saves in both layouts. Other play
commands remain disabled until the Engine reports a ready character.

## Browser graph replacement

On hosts offering the optional record edit handoff, pending character inputs,
their original saved base/revision, queued edit version and exact uncertain
save/command requests survive an SSE-driven rules-policy change, provider reload
or reviewed package replacement. The copy exists only in host-owned page memory.
No device drafts or historical versions are created.

Every replacement instance uses the current activation's services, including
when its immutable custom-element tag is unchanged. It loads current saved state
and verifies the actor/role before restoring pending input. A failed read retains
the guard and copy for retry. Recovery focuses its translated status and pauses
automatic saving; reviewing/adopting rules or retrying an uncertain request stays
explicit. Independent field rebases use the original saved inputs, never the
freshly loaded state as a false merge base. Overlapping edits remain conflicts.

A reviewed import retains its exact approved token and operation ID. The worker
can acknowledge an already committed import after restart. A definitively expired
review ends Retry and asks for a saved-state check before a new review; it never
creates or approves a replacement preview automatically.

Leaving the record, authority changes, disabling the add-on or closing/reloading
the page clears the transient handoff. Unsubmitted dialog fields and import text
that has not reached approved commit are not character input checkpoints.
Older hosts without this optional handle retain ordinary in-place save recovery.

## Source-defined size

Species size uses an ordinary Engine-owned Builder choice and the borrowed host
combobox. The UI translates explicit option label keys and leaves authored
record labels intact. Both sheet layouts and print read saved
`projection.sheet.derived.size` with source evidence; neither looks up a
species to guess a value. Older saved projections without the field remain
readable. A newly required size remains an unfinished choice until selected.

A species/source change uses the existing exact-slot repair rules. Surviving
choices, notes and play values retain their ownership; missing providers leave
the saved size readable. Temporary size transformations remain outside this
base-size display. The shared stat grid wraps by available space and text size,
rather than assuming two rows. The [W3C reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
informs this layout; the installed tests check desktop and enlarged Czech phone
views without claiming complete accessibility conformance.

## Builder guidance

The Engine owns required decisions, prerequisite checks, counts and repair
targets. Builder exposes the next required choice even with its progress rail
collapsed, prioritizes invalid decisions, and translates Engine label templates
in English and Czech. Authored catalog names remain source text.
First-class, lineage, subclass, advancement and spell targets open the relevant
section and focus its first unfinished visible control. Host `ui.controls.v1`
owns comboboxes and tabs; refresh enhancement before restoring keyboard focus
so the hidden native value select never receives focus. Before enhancement,
field keys include the owning choice, item or Builder target. Repeated labels
such as Selection 1 must not move focus to another acquisition after autosave.
Reduced-motion settings disable animated navigation.

Repeatable feat choices carry Engine-owned acquisition IDs and source labels.
The shared Builder controls render each set independently. A single historical
unscoped choice is attached to its sole owner in the Engine's detached result
and becomes durable only on an authorized save/adoption. Ambiguous historical
choices remain visible in an assignment panel: select an empty granting source
or explicitly discard them. They never populate every repeat or get silently
withdrawn as unavailable. Removing one acquisition preserves other acquisitions'
IDs, exact slots and authored play state.

## Equipment and attunement

Backpack moves and the worn-slot picker share one inventory transition.
Equipping armor or a shield replaces only an item currently equipped in that
Engine-declared slot. Stored/carried spares, item identity, attunement, notes
and acquisition details survive. Other worn items coexist. Unequipping does
not implicitly unattune; quantity-zero cleanup retains its existing behavior.

The Engine supplies action eligibility, physical slots and stable rejection
codes. New UI attunement selections require a positive-quantity equipped
instance and Engine eligibility. The picker lists only equipped candidates,
with translated descriptions for blocked prerequisites/capacity. Inventory
actions explain when an otherwise eligible item must first be equipped.
This is a selection rule, not a change to the stored or Engine contract:
existing carried/stored attunements remain valid, visible with their location,
count toward the saved capacity, and can always be explicitly released.

**Stow & unattune** sets that same instance's location to `stored` and its
attunement to false in one existing optimistic autosave. It preserves quantity,
reference, item/grant IDs, acquisition and notes; it does not change other
allocations. Focus returns to that item's Move control after the action
disappears. Existing uncertain-save exact retry and concurrency protection
apply to the complete transition. Ordinary Move and worn-slot removal still
preserve attunement; zero-quantity cleanup remains atomic. No schema or service
version changes are required. Custom item mechanics still require an
authenticated active DM grant; the UI never infers authority.

New projections retain slot facts for provider-free display. Older projections
fall back only to their saved `armorType` evidence, never a replacement live
catalog or a special item ID. Unavailable/changed rules keep mechanical editing
disabled until the existing recovery/adoption flow completes.

Inventory controls use stable per-item focus keys. The shared dialog helper
can initially focus its heading so long equipment explanations remain visible;
closing/choosing restores focus to the refreshed slot trigger. The dialog
continues to use the host's borrowed control styling and keyboard containment.
Both sheet layouts allow enlarged translated skill labels to wrap without
pushing totals off-screen; the backpack heading wraps around its Add item action.

## Rules and transfer

Without a compatible provider, saved projections and explanations render as
stored; mechanical changes stay disabled. Spell, sheet and projection details share
one adapter for the host's closed saved-evidence contract. Stored metadata and
spell facts stay in the projection; detail controls receive only their reference,
name, summary and hash. This preserves readable spell labels without a provider.
The versioned notes service remains
compatible for existing clients, but the sheet offers no character notes editor.
Loading never adopts changed rules. Tools provides explicit adoption.
A malformed response, incompatible contract version or broker validation failure
on load returns the unchanged saved state as unavailable. Provider validation
errors on edits remain errors; they cannot masquerade as a successful save.
Offline notes retain the exact accepted projection and rules identity.

If an autosave discovers changed rules, its rejected response updates the rules
status without replacing pending input or advancing the opening revision.
**Review changed rules** moves keyboard focus to Tools. With pending input, the
action is **Adopt rules and save pending changes**, with an explanation that the
same action saves those edits. Merely reviewing the rules writes nothing.
Adoption submits the current pending input directly; retrying the rejected old-
rules autosave first cannot succeed. An uncertain earlier request must still be
resolved before adoption. Existing revision, grant authority and Engine validation
remain mandatory, and adoption commands never rebase over another editor.

A successful adoption clears the changed-rules flag in the authoritative save
response, so the sheet can resume editing without an event-stream refresh.
A lost acknowledgment retains the exact adoption request for Retry and cannot
write a second revision. This recovery applies to the mounted generation; a
forced provider/package replacement has a separate lifetime boundary and remains
tracked in the suite backlog. No input is persisted as a device draft.
Tools actions wrap at their natural label widths on phones, including enlarged
Czech text, instead of forcing every button into the same narrow row.

Imports validate a closed current envelope, recalculate mechanics and preview
replacement before confirmation. Imported DM grants need the current DM's
authorization; imported mechanical acquisition/roll claims retain external origin.
The coordinator rejects empty or duplicate grant identities, assigns fresh IDs
and current DM provenance, and uses the Engine's identity helper to remap all
acquisition-owned references together. Choices, spell selections, casting
abilities, spent uses, activations and item links survive reauthorization without
mutating the supplied export. Ambiguous remappings fail before review or save.
Preview tokens bind actor, role, generation, character, expected revision,
operation and exact candidate, and expire after 15 minutes. Commit rechecks rules
and expiry. A stale token cannot apply a different candidate.

Requests are bounded to 190 KB, stored characters to 250 KB, transfer envelopes
to 1 MB and imported inputs to 180 KB. File and paste share validation. Export
and print use the current saved state and are available only in Tools.
File parsing, size and missing-DM-authorization errors appear inside the import
dialog, receive focus and retain the entered input. This browser explanation
does not replace server authorization. The replacement review initially focuses
its heading; closing either dialog restores the current Import action even
after a render. Both reuse the shared dialog, feedback and focus conventions.

Default print includes saved origin and class/level identity plus every stored
currency denomination. Equipment and spell toggles do not hide currency or
identity. Labels use saved source evidence and class levels use the saved Engine
projection; printing never requires a provider, recalculates or writes a revision.

The host must support worker-only extensions before this ZIP is activated.
Changing retention preserves the existing worker-authority schema identity.
Pre-existing retained archives and historical installation backups are left
untouched; the character service no longer exposes them or creates new entries.
Live installation and any archive deletion remain separate operational actions.

## Profile notes and presentation

Character notes are edited through the host profile. The sheet no longer renders
a character Notes tab, editor, or printed notes section. Existing schema-4 notes
and the versioned service remain compatible for saved data and transfer; this UI
change does not erase existing character content. Item-specific notes remain
part of inventory.

## Spell ownership, filtering and saved Combat details

Builder and play share one name/level filter with a live result count and explicit empty state. Class spells, rituals and granted spells participate; filtering does not edit selections. Grant labels include their acquisition, and host-enhanced controls keep stable field keys. Both locales and layouts use the same component.

Spell choices, casting abilities, activations and counters follow Engine acquisition keys. Unassigned older state has an explicit source picker or discard action in Builder. Ambiguous aliases never fan out. After a structural edit, the coordinator withdraws only Engine-rejected selections already present in the saved snapshot; it preserves valid sibling spells and counters, rejects newly invalid input, and does not reset an available counter. A save response applies corrections without resurrecting removed choices or overwriting subsequent edits.

Combat displays saved damage type, versatile damage, mastery availability, sense units and conditional explanation terms. Saved details and print remain independent of a live rules provider. The browser performs no edition arithmetic.

## Focus after a completed repair

Shared control focus restoration keeps the existing action when usable. If a
completed edit disables that action, a declared `data-focus-scope` limits the
fallback to the next usable control in the same row (or the preceding control
when none follows). Inventory rows use this for explicit unattunement after
losing a prerequisite. The action stays disabled and eligibility remains owned
by the Engine; focus never jumps to another item or the document body.
