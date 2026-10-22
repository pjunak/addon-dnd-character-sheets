# Character saves and failure semantics

The coordinator owns the current `dnd-sheets` extension for each core character
lifetime. The stored schema is 6.1.0; its optional authored play fields are
described below. The core profile, portrait and relationships are host-owned.

## Schema updates

Any change to the stored schema, even a new optional field, ships as a new
`SchemaVersion` with an upgrade ([below](#changing-the-stored-format)).
`internal/character/stored_format_test.go` pins each released format's schema
digest and a frozen saved sheet (`testdata/sheet-state-5.0.0.json`), so CI fails
when the schema changes without a version bump or an older sheet stops loading.
Installing a changed schema goes through the host's
[guided update confirmation](https://github.com/pjunak/ttrpg-codex/blob/main/docs/SELF_HOSTING.md#add-on-installation):
choose **Heal and update** to keep existing characters with their exact JSON
and document revisions. Old characters do not gain default values. Removal is
an explicit alternative that clears current sheet saves. Rolling a package back
after new values are saved may be blocked if the older schema cannot represent
them.

### Changing the stored format

Renaming, removing or retyping a saved field must not clear players' sheets.
Carry them forward instead:

1. Copy the current `contracts/sheet-state.schema.json` to
   `contracts/legacy/sheet-state-<old version>.schema.json`.
2. In `internal/character/upgrade.go`, register an `Upgrade` keyed by the old
   `schemaVersion` that turns an old JSON object into the new one and sets the
   new `schemaVersion`.
3. Change the Go types, bump `SchemaVersion` (and the manifest's
   `schemaVersion`), then build. The generated stored schema accepts the
   current format and every frozen legacy format. Add the new format's schema
   digest, which the failing guard prints, to `storedFormats`.
4. Install the update with **Heal and update**: existing sheets still validate,
   so the host keeps them. The worker upgrades each sheet when it loads it and
   saves it in the new format.
5. Drop a legacy schema and its upgrade only once no saved sheet can still use
   it (for example after every character has been opened and saved, or a later
   release).

Unknown formats still fail without partial normalization; `upgrade_test.go`
covers chained upgrades and rejection. The frozen 5.0.0 sheet must keep loading
through the upgrades and validating against the generated schema; never edit
it to make a change pass.

The 5.0.0 upgrade keeps the saved inputs and rules state and carries the old
snapshot over as far as the typed Engine 6 sheet can read it. The first load
then recomputes the snapshot from the saved inputs, so the sheet shows complete
Engine 6 results before it is next saved.

The 6.0.0 upgrade only renames the format: 6.1.0 added the optional
`baseItemId` and `bonus` picks of a magic weapon or armor
([Magic weapons and armor](#magic-weapons-and-armor)). Each frozen schema is
embedded with its own definitions, so an older format is checked against its
own types.

## Authored conditions

Optional `inputs.play.conditions` stores the Engine-owned `{id,level}` DTO.
Compact and Classic Combat use one shared condition panel, borrowed combobox,
native level input and explicit removal actions. Current condition levels,
source summaries and roll adjustments also survive print/export without rules.
Controls require live `guidance.authoredPlay.conditions`; unavailable sources
leave existing selections removable without inventing catalog defaults.

The worker rejects providers that drop, reorder or rewrite this authored list
during evaluation or play. Automatic saving, exact retries, conflict handling
and replacement import use the ordinary character boundary. Recalculation and
rests preserve the list. Displayed Speed includes declared restrictions; the
separate D20 adjustment must be applied once to rolls, without changing printed
bonuses or save DCs. Other effects require table adjudication; see the
[Engine contract](../../addon-dnd-engine/contract/README.md#authored-conditions).

Conditions that active magic items give are `granted: true` rows in the
projection, not authored state. Both layouts and print show their level and
granting items without remove or level controls; an authored condition with the
same ID keeps its own row.

## Inspiration

`inputs.play.inspiration` is an optional boolean. Absent means unavailable
without adding a value to an existing character; explicit false records spending
it. Sheet and Combat share one labelled native checkbox and automatic-save path.
Editing requires `guidance.authoredPlay.inspiration: true` from the selected
Engine. It also works for legal unfinished builds. Recalculation, rest and other
play operations preserve the value; no automatic awards or dice rerolls occur.

The worker rejects an Engine result that drops or changes authored Inspiration.
Provider-free display, print and export retain the value. Replacement imports
carry explicit false and true values through the ordinary review. Concurrent
disjoint fields may merge; conflicting explicit values remain pending.

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
instance's pin in one autosave, together with the uses, toggles, spell picks and
casting ability its magic item owned (`item:<inventory id>:…` keys). While the
entry exists, that state stays saved even when the item is inactive, so it is
never offered for discarding. Missing or duplicate references from other
clients/imports are rejected rather than silently repaired. Independent fields
can merge, competing pin lists conflict, and a merge against a remotely deleted
item remains pending for explicit unpinning; it cannot recreate the entry.

The coordinator rejects an Engine response that drops, reorders or substitutes
pins. Incompatible providers leave saved state readable. Print/export
preserve pin order and depleted entries; reviewed replacement import validates
references normally.

## Storage identity and membership

Optional `inputs.play.containers` holds flat named groups; an item's optional
`containerId` refers to one group. These organize owned instances without
creating backpack items or changing carried/stored location. A group's optional
`itemId` links it to the inventory entry that is the container; the Engine then
reports its capacity and whether its contents count (`sheet.carrying`), but
nothing is enforced. Deleting that entry clears the link in the same edit.
Names may repeat; IDs distinguish the groups. Equipped items cannot be assigned,
and explicit equipping removes the selected item's membership atomically.
Depleted entries, quick-use pins, grants, notes and existing attunement survive.

An item's optional `weightLb` is an authored weight per unit for custom items
and items whose rules give none; `play.coinWeight: false` leaves coins out of
carried weight. Optional `play.concentration` (`{ref, saveDC?}`) changes only
through Engine play commands: casting, damage, `keep-concentration` and
`end-concentration`. All are optional: existing sheets stay valid, and a
version that adds optional fields installs with Heal and update.

The Backpack window and Classic's backpack create, rename and remove containers
and edit inventory entries with the same item controls. The existing item picker offers the same destination list
for catalog and narrative additions; additions remain separate instances.
Removing a group unassigns only its members without deleting inventory.
Native labelled fields/actions use `ui.controls.v1`, semantic tokens and stable
focus keys. Every field is created with an explicit key built from IDs, and
the renderer derives its controls' focus keys from it. Editing requires live `guidance.authoredPlay.storage`; counts and
labels remain readable without a provider, and print/export retain membership.

The worker rejects results that drop, rename, reorder or substitute groups or
change membership. Engine validation rejects dangling memberships, invalid names,
duplicate IDs and equipped assignments without normalization. Disjoint edits may
merge; competing container or inventory arrays conflict. A concurrent removal can
leave a merged assignment invalid: it remains pending for explicit unassignment,
never a silent recreation. Reviewed replacement import uses the same validation.

## Body placement and source eligibility

Optional `inputs.play.inventory[].bodyPlacement` organizes a positive-quantity
equipped instance. The shared inventory control uses live Engine
`authoredPlay.bodyPlacement` support and `equipment[id].bodyPlacements`
options. Native labels, styling, keyboard operation and stable focus keys use
the host UI. It does not infer compatibility from names, tags or a humanoid grid.
Multiple items may share a group. Armor/shield limits, supported mechanics and
attunement are checked separately; custom items still need active DM authority.

Characters without placements remain unchanged. The same instance retains notes,
source, acquisition, quantity, grants and attunement when placement changes.
Moving it to carried/stored, replacing its exclusive armor/shield slot, setting
quantity to zero, or explicitly stowing/unattuning clears placement atomically.
Consuming the final unit does likewise through the worker play command.
Rest and recalculation preserve it. The worker rejects dropped/substituted
placements in provider results except that exact final-unit transition.

A removed source option leaves a visible unavailable selection which can be
cleared for repair; no default replacement is saved. Disjoint edits can merge,
but competing inventory changes retain pending input for conflict resolution,
including remote item deletion. Lost responses retry the exact request.
Saved reading, print and replacement export/import retain placement without
a provider.

## Hands and suspended equipment

Optional `inputs.play.hands` follows the [Engine-owned contract](../../addon-dnd-engine/contract/README.md#hands-and-grip).
Sheet and Combat share native labelled main/off-hand fields and a central
two-handed toggle, enabled by live `guidance.authoredPlay.hands`. The same
component uses borrowed controls, semantic tokens and stable focus keys in both
layouts. The toggle keeps a stable accessible label and `aria-pressed`, following
the [WAI button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/).
Its selected appearance uses the host's primary variant. Suspended items remain
visible in muted text with an explicit inactive explanation; color alone does
not convey their state. Combat alone adds saved attack/damage detail controls.

The Engine owns closed `set-hand` and `set-grip` commands. They work on legal
incomplete builds and save through the ordinary optimistic worker path.
Two-handing carries the exact selected off-hand item and suppresses its active
effects; its attunement allocation remains. Releasing restores only an unchanged,
still eligible instance, including its prior compatible body placement. A moved,
edited, consumed, removed or newly blocked item is never silently restored or
recreated; the saved projection explains the refusal. Hand changes do not track
turn, action or shield don/doff timing.

The coordinator allows only the requested hand identities and involved item
location/container/placement transitions. It rejects provider changes to notes,
quantities, grants, attunement, other instances or unrelated Play values, and
checks exact restoration fingerprints. Ordinary evaluations, rests and other
commands cannot rewrite the hand state. Conflicting revisions remain explicit;
uncertain writes retain the exact command and operation ID for Retry.

Provider-free saved reading, printing and reviewed replacement transfer keep
main/off-hand, grip and suspended-instance identity. Characters without hand
state do not gain default fields.

## Automatic saving

`dnd5e.character` 4.0.0 exposes `load`, `evaluate`, `save`, `preview` and `commit`
using `character.v3` / `character-response.v3`. There is no history, revision
lookup, comparison or restoration. Transfers contain the current character
only; there is no browser draft or frozen-import store.

The worker checks the current revision, authenticates grants, evaluates mechanics
and writes the latest inputs/projection through the host's ordinary transaction.
The extension declares `workerOnly: true`.
Optimistic revision numbers and the last operation ID protect concurrency and
lost-response retries; they are not a browsable history. Normal host transaction
bookkeeping remains part of database integrity. A character whose sheet was
removed loads empty at the host's deleted revision, so the next save or import
recreates it instead of conflicting forever.

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

Changing an earlier origin or level, amending/revoking a DM grant, or adopting
changed rules removes only previously saved selections that the Engine
identifies as unavailable choices, ineligible options or slots beyond the new
choice count. Stable issue IDs identify the exact slot; valid siblings and newly
edited replacements survive. Dependent withdrawals settle until no more saved
selections are removed. Newly supplied illegal choices are rejected, and other
rule violations remain visible for deliberate repair. The save response lists
the removed selections (`withdrawn`) and the sheet shows them in its status.
Once withdrawals settle, the Engine lowers current HP to a lowered maximum;
raising the maximum never heals. Other authored play state is preserved unless explicitly
changed. Amending/revoking a DM grant replaces or removes its current entry,
without retaining superseded grants.

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
An unchanged revision with no warning retains the visible Saved acknowledgment
after that read. A newer remote revision or a rules/availability message replaces
it; the refreshed guidance still determines which controls are available.
Reload requires explicit confirmation before discarding pending edits.

Direct play, grant/amend/revoke and rules-adoption commands also retain their
exact request after an uncertain response. Reviewed imports retain the approved
token, operation ID and expected revision; Retry never makes a new preview or
bypasses review. Further mutations and background refresh pause until the outcome
is resolved, and the host navigation guard remains active. Any answer from the
worker is definite: a refusal by the rules (`invalid`, with the engine's reason),
unavailable rules, a rules change or a revision conflict saves nothing, so the
command ends at once. A client error other than timeout, conflict or rate limit
is equally definite. A conflict reloads the saved character; commands never
rebase automatically onto another editor's changes. An explicit
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

While changed rules wait for adoption, a DM can still revoke or amend existing
grants, for example one naming a record the new sources no longer provide. The
change joins the pending edits instead of running as a command: its autosave
answers `rules-changed`, and adopting the rules saves it. The worker accepts
grant changes in a DM's `build` or `adopt-rules` input only then and only for
existing grants, and records amendments as `amend-grant` does (actor, time,
required reason, item link). A new grant waits for the adoption.

Create and amend share the same form. Effect rows retain their controls and
stable field identities as other rows change. Adding a row focuses its target;
removing one focuses the next row, previous row, or Add effect. Each group has a
wrapping heading with its full effect name, including on enlarged phone layouts.
Required fields use native form validation and keep incomplete input in the
dialog. The dialog closes only once the grant is saved; when the grant cannot
start yet (unsaved edits, an uncertain earlier action) or the service refuses
it, the dialog keeps the input and says why. Feat and item searches borrow host
ui.controls.v1 comboboxes; the Engine still owns mechanical validity.

Separate acquisitions of the same feat (for example two Magic Initiate picks)
each keep their own choices, casting ability and spent uses through effect
changes, item rebinding, provider restarts and source-policy changes. A provider
restart alone keeps the rules identity; a policy change requires explicit
adoption. Replacing the engine with an incompatible service version or response
schema leaves the saved state, including spent casts, untouched. A sheet-schema
change is blocked before activation; worker-only writes and the exact schema-5
state stay protected, including in a portable backup.

## Class-granted choices and spell pickers

Class-granted feats and conditional spell alternatives use the same Engine-owned
Builder descriptors and spell pickers as other sources. Source lists, counts,
casting abilities and branch availability stay in the provider/Engine; Sheets
adds no class-specific controls. Changing a branch uses the existing exact-choice
and spell-grant withdrawal policy while preserving unrelated saved state.

Class-level replacements use one shared panel in each owning class tab, in
both layouts. The Engine supplies the allowance, selected values and eligible
replacements; borrowed host comboboxes collect the command. The result retains
keyboard focus on the spent-allowance message. Legal incomplete builds remain
editable, and no allowance or class rule is inferred by the UI.

The optional typed `build.replacements` ledger is worker protected. Ordinary
edits cannot add, erase or rewrite it; an authorized replacement changes only
the selected feat/spell slot and appends one entry. Every other authored value
must survive the provider response. Exact command retries, stale-revision
rejection and saved-state recovery use the existing command coordinator.
Imports retain consumed allowances with external origin. A provider that drops
the ledger is incompatible: the saved projection, reading and export remain
available, while mechanical edits require compatible rules.

The shared spell picker uses the existing wrapping control layout to separate
each checkbox label from its borrowed rule-details control. Builder and Manage
spells share this rendering and focus behavior, including enlarged phone views.

## Saved feat display

Combat details and print share the same feat renderer, borrowing the host's
rule-details control and reading the Engine's acquired `sheet.feats` identities
and counts. Summaries come from exact kind-and-ID matches in saved evidence.
Provider-free output never queries the catalog or infers an acquisition from
unrelated evidence. A projection without this list stays readable; a deliberate
recalculation captures newly available output.

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
informs wrapping without fixed column counts.

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

## Source-defined size

Species size uses an ordinary Engine-owned Builder choice and the borrowed host
combobox. The UI translates explicit option label keys and leaves authored
record labels intact. Both sheet layouts and print read saved
`projection.sheet.derived.size` with source evidence; neither looks up a
species to guess a value. A projection without a size stays readable. A newly
required size remains an unfinished choice until selected.

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
so the hidden native value select never receives focus. Field keys name the
owning choice, item, level or Builder target and never come from label text,
so repeated or translated labels such as "1 of 2" do not move focus to another
acquisition after autosave.
Reduced-motion settings disable animated navigation.

Repeatable feat choices carry Engine-owned acquisition IDs and source labels.
The shared Builder controls render each set independently. Removing one
acquisition preserves other acquisitions' IDs, exact slots and authored play
state, and its choices are never rebound to another acquisition.

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
preserve attunement; zero-quantity cleanup remains atomic. Custom item mechanics still require an
authenticated active DM grant; the UI never infers authority.

Projections retain slot facts for provider-free display. An item without a
saved slot (for example one added while rules were unavailable) falls back only
to its saved `armorType` evidence, never a live catalog or a special item ID. Unavailable/changed rules keep mechanical editing
disabled until the existing recovery/adoption flow completes.

Inventory controls use stable per-item focus keys. The shared dialog helper
can initially focus its heading so long equipment explanations remain visible;
closing/choosing restores focus to the refreshed slot trigger. The dialog
continues to use the host's borrowed control styling and keyboard containment.
Both sheet layouts allow enlarged translated skill labels to wrap without
pushing totals off-screen; the backpack heading wraps around its Add item action.

## Magic weapons and armor

A magic item whose record declares a base form (`baseItem`) is a weapon or
armor of that base, such as the DMG's "Weapon, +1, +2, or +3" or a homebrew
"+1 Longsword". The Engine lists what an inventory entry may be in
`guidance.equipment[id].baseItems` and `bonuses`; the item editor shows a
**Base weapon or armor** and a **Magic bonus** select when there are several
options or the entry already has a pick, and writes the authored
`baseItemId`/`bonus` like any other item field (cleared by choosing the empty
entry). A pick the item no longer offers stays selected as unavailable until it
is changed. Panels never resolve the base or apply the bonus themselves: attack
rows, Armor Class and its explanation come from the Engine, and the entry's
inventory and attack rows add a muted "Longsword, +1" note unless the item's
name already says so. Without rules the note names a picked base from the
catalog or saved evidence only. New copies never join a stack whose entry has
picks, so each copy keeps its own base and bonus.

## Rules and transfer

Without a compatible provider, saved projections and explanations render as
stored; mechanical changes stay disabled. Spell, sheet and projection details share
one adapter for the host's closed saved-evidence contract. Stored metadata and
spell facts stay in the projection; detail controls receive only their reference,
name, summary and hash. This preserves readable spell labels without a provider.
Loading never adopts changed rules. Tools provides explicit adoption. Until
then, Builder, spell and other authored edits stay available so a character the
new rules reject can be repaired; their autosaves answer `rules-changed` and keep
the input for the adoption; a DM's grant revocations and amendments do too.
Play commands and new DM grants wait for it.
A malformed response, incompatible contract version or broker validation failure
on load returns the unchanged saved state as unavailable. Provider validation
errors on edits remain errors; they cannot masquerade as a successful save.

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
forced provider/package replacement has a separate lifetime boundary. No input
is persisted as a device draft.
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

Character data is bounded by the Engine's published request limit
(`character.MaxRequestBytes`, 180,000 bytes). The worker checks each Engine
payload against it before calling, and each state before saving, so a saved
character can always be evaluated again. Stored characters are bounded to
250,000 bytes, including their saved explanations and rules evidence, and
transfer envelopes to 1 MB; the browser checks imported inputs against the same
published limit. Data over a limit is answered `too-large` with its size;
nothing is saved and pending input stays on the page. A saved character over
the Engine's limit loads as without compatible rules. File and paste share
validation. Export and print use the current saved state and are available only
in Tools.
File parsing, size, missing-DM-authorization and refused-review errors appear
inside the import dialog, receive focus and retain the entered input; a review
the rules refuse lists their blockers under the reason. The dialog also says
when unsaved edits or an uncertain earlier action must be resolved first. This
browser explanation does not replace server authorization. The replacement
review initially focuses its heading and closes only once the replacement is
saved; closing either dialog restores the current Import action even after a
render. Both reuse the shared dialog, feedback and focus conventions.

Default print includes saved origin and class/level identity plus every stored
currency denomination. Equipment and spell toggles do not hide currency or
identity. Labels use saved source evidence and class levels use the saved Engine
projection; printing never requires a provider, recalculates or writes a revision.

## Profile notes and presentation

Character notes are edited through the host profile; the sheet stores no
character-level notes. Item-specific notes remain part of inventory.

## Spell ownership, filtering and saved Combat details

Builder and play share one name/level filter with a live result count and explicit empty state. Class spells, rituals and granted spells participate; filtering does not edit selections. Grant labels include their acquisition, and host-enhanced controls keep stable field keys. Both locales and layouts use the same component.

Spell choices, casting abilities, activations and counters follow Engine acquisition keys. Saved state whose source is no longer available has an explicit discard action in Builder. After a structural edit, the coordinator withdraws only Engine-rejected selections already present in the saved snapshot, including a subclass the Engine marks `subclass-level` and class spell lists it marks `spell-class` after a level is removed; it preserves valid sibling spells and counters, rejects newly invalid input, and does not reset an available counter. A save response applies corrections without resurrecting removed choices or overwriting subsequent edits.

The spellbook picker's limit is the Engine's `spellbookCapacity` (granted plus copied spells).

Combat displays saved damage type, versatile damage, mastery availability, sense units and conditional explanation terms. Saved details and print remain independent of a live rules provider. The browser performs no edition arithmetic.

## Focus after a completed repair

Shared control focus restoration keeps the existing action when usable. If a
completed edit disables that action, a declared `data-focus-scope` limits the
fallback to the next usable control in the same row (or the preceding control
when none follows). Inventory rows use this for explicit unattunement after
losing a prerequisite. The action stays disabled and eligibility remains owned
by the Engine; focus never jumps to another item or the document body.
