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

The engine's `guidance.canSave` permits legal incomplete builds. `ready` still
requires all choices and mechanical bounds to pass before play commands run.
Point buy, granted budgets, source choices and class prerequisites come from the
engine. UI controls prevent overspending and duplicate selections; server
validation also protects against stale or forged requests.

Changing an earlier origin or level removes prior choices that are no longer
granted or eligible. Newly supplied illegal choices are rejected. Lower maximum
HP clamps current HP; raising the maximum never heals. Other authored play state
is preserved unless explicitly changed. Amending/revoking a DM grant replaces or
removes its current entry, without retaining superseded grants.

The browser serializes and coalesces pending edits. Independent concurrent fields
can rebase automatically; overlapping fields/arrays remain pending with a visible
conflict. Failed writes do not claim success. Pending input stays in the open
page, with the host navigation guard, and is not durable until saved.

## Rules and transfer

Without a compatible provider, saved projections and explanations render as
stored. Notes save against their accepted projection; mechanical changes stay
disabled. Loading never adopts changed rules. Tools provides explicit adoption.

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
