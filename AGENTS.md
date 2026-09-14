# AGENTS.md — addon-dnd-character-sheets

This repository owns the `dnd-sheets` Add-on API v3 TypeScript package for the
sibling `ttrpg-codex` host. The add-on ID and record-extension ID are permanent
saved-data namespaces. Do not rename either without an explicit campaign data
migration.

## Read by task

Sibling paths in this guide assume the named repositories are checked out
next to this one. For an independent checkout, locate the compatible public
host/consumer contracts only when needed; do not assume parent workspace
instructions were loaded or read unrelated sibling implementations.

1. [`README.md`](README.md) for setup, behavior or commands.
2. [`docs/RULES_EDGE_CASES.md`](docs/RULES_EDGE_CASES.md) for service,
   materialization or failure-semantics changes.
3. [`../ttrpg-codex/examples/addons/API_V3.md`](../ttrpg-codex/examples/addons/API_V3.md)
   when changing the manifest, host integration, permissions or lifecycle.
4. [`../addon-dnd-engine/AGENTS.md`](../addon-dnd-engine/AGENTS.md) and its
   `contracts/` documents before changing rules-engine requests.

## Boundaries

- The host owns the core character record. This package contributes one
  additive `article-section`; it never replaces the host article or reads
  private host DOM.
- `internal/character/model.go` and the engine's public `character` types own
  the closed stored schema. Generate schemas and TypeScript types through the
  owning build; unsupported formats fail without partial normalization.
- The native `internal/character` coordinator is the only persistent character
  boundary. It authenticates DM commands and writes optimistic current state automatically.
  Imports use exact replacement previews. No character history or device drafts.
- `src/character-client.ts` owns browser service, transfer and conflict merging.
  Rules-engine calls remain serializable and versioned; runtime policy must
  never select providers by a sibling add-on ID.
- Without compatible rules, saved projections, print and export
  remain usable. Mechanical changes require rules; no manual stat fallback.
- Current HP, inventory, currency, resources, spells, and item notes are authored
  play state. Recalculation must preserve them unless a user explicitly edits
  them.
- Panels and controls do not implement edition-dependent rules. Controls consume engine-provided budgets, costs and eligibility. Ability modifiers and all mechanical bounds come from
  the engine with structured explanations.
- The removed v2 renderer service must not return as a live object/function or
  raw-HTML boundary. A future renderer contract must be serializable,
  schema-owned, selected by the host, and justified by a real consumer.
- Runtime source is TypeScript under `src/`; never hand-edit generated `web/`
  or `dist/`. Regenerate and commit intentionally tracked `web/` outputs with
  source changes; install ZIPs and staging directories remain transient.

## Release and installation

Successful main builds publish the inspected ZIP to a durable commit release;
the source commit identifies an update even when the manifest version stays the
same. Follow the [README installation guide](README.md#install-and-update-from-tested-commits).
Each site's owner chooses **Latest published package**, reviews permissions and
activates the package. Publication never installs it automatically.

The host image is deployed separately by `pjunak/infra`. This add-on has no
Compose deployment target or infra dispatch credential. Release publication uses
the workflow's repository-scoped job token; private downloads use host-managed
GitHub credentials. Preserve the reviewed package lifecycle on both sites.

## Working loop

For prose or agent-guidance-only changes, review the diff, check local links,
and verify changed commands or contract claims. Runtime builds and operational
acceptance are required only for the affected behavior below. Reuse successful
checks on unchanged inputs; preserve complete CI and release gates.

Run npm run check for source/build changes. Build a package for installation,
manifest/schema/package changes and release candidates. Each package command
performs its own build; keep that standalone guarantee. During iteration use
focused tests and reuse a successful build only through an existing checked
script, not by silently bypassing package preparation.

```powershell
npm run check
npm run package
```

Use the host inspector on the produced ZIP when manifest, contract, or package
layout changes:

```powershell
go run ./cmd/codex-addon-inspect ../addon-dnd-character-sheets/dist/dnd-sheets-4.0.0.zip
```

Integration uses the staged-package review and activation lifecycle. Source
checkout edits never become a runtime generation directly.

Create logical commits after validation. Never push, deploy, or convert live
campaign data without explicit instruction.
