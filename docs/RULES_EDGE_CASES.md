# Character saves and failure semantics

The coordinator owns the current `dnd-sheets` extension for each core character
lifetime. Schema 4.0.0 retains its existing shape so installed characters remain
readable. The core profile, portrait and relationships are host-owned.

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
codes. Both layouts show translated reasons, and the attunement picker includes
blocked candidates with descriptions instead of suggesting an empty backpack.
The capacity count comes from the saved projection. Custom item mechanics
still require an authenticated active DM grant; the UI never infers authority.

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
stored; mechanical changes stay disabled. The versioned notes service remains
compatible for existing clients, but the sheet offers no character notes editor.
Loading never adopts changed rules. Tools provides explicit adoption.

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
Preview tokens bind actor, role, generation, character, expected revision,
operation and exact candidate, and expire after 15 minutes. Commit rechecks rules
and expiry. A stale token cannot apply a different candidate.

Requests are bounded to 190 KB, stored characters to 250 KB, transfer envelopes
to 1 MB and imported inputs to 180 KB. File and paste share validation. Export
and print use the current saved state and are available only in Tools.

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
