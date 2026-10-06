# D&D Character Sheets add-on

The `dnd-sheets` TTRPG Codex add-on: progressive character building, play and
automatic saving (TypeScript UI plus a native Go worker). The add-on ID and the
record-extension ID are permanent saved-data namespaces; never rename them.

This is a personal project: keep saved characters safe first, then the UI
friendly and the code clear. Old formats and extra hardening are low priority.

## Read by task

1. [README.md](README.md) for setup, behaviour and commands.
2. [docs/WORKFLOW.md](docs/WORKFLOW.md) for how building, saving and transfer
   work from the player's side.
3. [docs/RULES_EDGE_CASES.md](docs/RULES_EDGE_CASES.md) before changing the
   service, materialization or failure behaviour.
4. The Engine's `contract/README.md` before changing rules-engine requests, and
   the host's [add-on guide](https://github.com/pjunak/ttrpg-codex/blob/main/examples/addons/AUTHORING.md)
   for manifests, permissions or lifecycle.

## Boundaries

- The host owns the core character record. This add-on contributes one additive
  `article-section` and never replaces the host article or reads host DOM.
- `internal/character/model.go` and the Engine's public `character` types own
  the closed stored schema. Generate schemas and TypeScript types through the
  build; unsupported formats fail without partial normalization.
- The native `internal/character` coordinator is the only writer. It
  authenticates DM commands and saves current state automatically, with
  optimistic revisions. Imports use exact replacement previews. There is no
  character history and no device draft.
- `src/character-client.ts` owns browser service calls, transfer and conflict
  merging. Rules-engine calls stay serializable and versioned; never pick a
  provider by add-on ID.
- Without compatible rules, saved projections, print and export keep working;
  mechanical changes need rules. There is no manual stat fallback.
- Current HP, inventory, currency, resources, spells and item notes are authored
  play state; recalculation preserves them unless the user edits them.
- Panels and controls never implement edition rules. Budgets, costs,
  eligibility, modifiers and bounds come from the Engine with explanations.
- Author source in TypeScript; `web/`, `worker/` and `dist/` are ignored build
  output. Generated public schemas and TypeScript models stay versioned and the
  build must leave tracked source unchanged.

## Working loop

```text
npm run check:fast     # source guard, types, Oxlint, Prettier, fast Go checks
npm run check          # build, TypeScript tests, all Go tests
npm run package        # dist/dnd-sheets-<version>.zip
go tool -modfile=go.tools.mod codex-addon-inspect dist/dnd-sheets-<version>.zip
```

The repository builds from a plain clone; the host SDK and Engine model are
normal Go module requirements. To work against local changes in either, use an
uncommitted `go work init . ../ttrpg-codex ../addon-dnd-engine`. Tasks for all
repositories live in the host's `docs/BACKLOG.md`.

Successful `main` builds publish the inspected ZIP as a GitHub release; DMs
install it through Settings → Add-ons. Ask before pushing, deploying or touching
live campaign data.
