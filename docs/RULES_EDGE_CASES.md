# Character revisions and failure semantics

The coordinator owns a single retained `dnd-sheets` extension per core
character lifetime. Its permanent schema is 4.0.0. The core profile, portrait,
lore and campaign relationships remain host-owned.

## Review and commit

`load`, `evaluate`, `preview`, `commit`, `history`, `revision`
and `compare` use the `character.v1` request and
`character-response.v1` response. JSON schemas are generated from
`internal/character/model.go`. Requests are bounded to 190 KB and retained
snapshots to 250 KB. The host shares unchanged top-level JSON payloads by hash.

Preview tokens bind actor, role, generation, character, expected revision,
operation ID, operation, summary, rules identity and exact candidate. Reviews
expire after 15 minutes, with a bounded cache. Commit re-evaluates mechanics
against the same accepted rules and rejects stale revisions or newly expired
effects. The host atomically writes current state, immutable history, audit and
idempotency receipt. A repeated completed head operation is acknowledged after a
lost response or worker restart. A later intervening head requires a new review.

The server verifies DM authority for give/amend/revoke and imported/restored
grants. Client labels, actor IDs, timestamps, projections and imported histories
cannot confer authority. Generic edits cannot manufacture play-roll, paid
acquisition or replacement ledger entries. Import remints local grant IDs and
remaps linked inventory; its external roll/ledger claims are marked as imports.

## Propagation and recovery

Changing an early decision recalculates dependent values and retains invalid
later choices for repair. If maximum HP falls below current HP, the review
includes the required clamp; increasing the maximum does not heal. Spent counters
and attuned items that no longer fit remain visible blockers until resolved.
Grant amendments retain the original entry as revoked and create a newly
attributed grant. Revocation uses the same engine evaluation as granting.

The default restore replaces Build and DM grants while retaining current play,
notes, and paid acquisitions with their consumed inventory/currency. A copied
spell may need review when its class is removed. Play-only restoration replaces
play state; complete restoration includes all authored inputs. Every restore
uses current approved rules and creates a new revision. An old saved projection
remains available exactly as captured even if recalculating its inputs today
would differ. DM grant differences need explicit DM authorization.

Host campaign recovery also appends retained head revisions. Backups preserve
all referenced history payloads. Deleting/recreating a core record cannot inherit
another lifetime's revisions; viewer visibility is rechecked for every read.

## Missing and changed rules

Saved projection/evidence always renders without contacting a provider. Rules
changes are reviewed explicitly; loading alone never adopts them. When rules
are absent, derived values and mechanical actions are frozen, with notes saved
under their accepted projection. No hand-editable stat fallback exists.

Browser drafts remain local and editor-scoped; they are separate from saved
history and are excluded from saved exports/prints. Malformed drafts remain in
storage and report recovery failure instead of being silently discarded. Storage
quota failure prompts draft export. Live invalidations update a clean view but
preserve dirty input and focus until explicit review/rebase.

## Transfer and print

Current transfers contain inputs, accepted rules identity and saved projection.
File and paste have the same 1 MB envelope and 180 KB input limit. The server
validates a closed schema and recalculates imported mechanics before activation.
Replacement keeps the previous local revision. Ordinary installation backups
remain the complete history/recovery archive.

Exports can include up to five recent exact snapshots within the same 1 MB
limit. Oversized requests fail explicitly and offer fewer revisions. The
`externalHistory` array is unverified reference material: its actors and results
are displayed separately and never appended to the installation's audit trail.
Only the main `inputs` are submitted to the authenticated import operation.

The original transfer can be saved as a frozen, editor/character-scoped device
draft when rules are unavailable. It survives reload and remains exportable
until explicitly discarded, including after a reviewed import is committed.
It is not an active sheet and its snapshots are never trusted calculations.
Device transfers, like other local drafts, are outside installation backups.
Keep the export file when moving browsers or devices.

Spellbook selection order allocates level-granted slots to their effective
character/class level. The engine checks each spell at that level; the editor
offers explicit reordering. Paid copies use their separate acquisition ledger
and do not consume a level-granted slot or recreate consumed scrolls/gold.

Print is a detached text rendering of a selected saved revision. It never calls
the engine. Resource names, spell names and source labels come from that saved
snapshot. DM markers remain visible and optional provenance includes build
decisions, source hashes and engine identity. Source links on screen deliberately
identify newer current entries separately from retained explanation evidence.
