# Slice 6C.3A: Change Notice public surface

## Baseline

- Branch: `feat/change-notice-operational-impact`
- HEAD: `51d5d8f796` (`test(erp): add real PostgreSQL Impact task and deletion evidence`)
- The worktree was clean before this slice.

## Finding

The generic Carbon API path uses the generated operation catalog for HTTP v1, MCP, and server-side `callOperation()` calls. The workflow dispatcher also uses `callOperation()`, while the agent currently exposes reads only. `MCP_BLOCKED_TOOL_NAMES` removes a name during metadata generation and rejects it again at shared dispatch, so it closes both discovery and execution without changing browser imports.

The following raw engineering writers have no complete route-level boundary when called through generic dispatch:

- `items_updateChangeNotice`: no Change Notice lookup or lifecycle check. It can edit engineering fields on an implementing or closed notice.
- `items_updateChangeNoticeStatus`: validates a transition, but does not call `applyChangeNotice()`. A generic `Implementation -> Done` call can skip release of staged methods and items.
- `items_createChangeNoticeDraftMethod`: an internal helper with caller-controlled notice and item identifiers and no parent ownership or lifecycle check.
- `items_addChangeNoticeAffectedItem`: no parent ownership or lifecycle check. It can add frozen scope and create CO-owned drafts.
- `items_updateChangeNoticeAffectedItemChangeType`: no parent lifecycle check before rebuilding a child draft.
- `items_updateChangeNoticeAffectedItemCutover`: updates by child ID without a parent or lifecycle check and does not expose a valid server-owned actor parameter.

The generic metadata derived `parts:create` for `items_addChangeNoticeAffectedItem`, although the browser route mutates an existing Change Notice under `parts:update`. Blocking the raw operation avoids widening the permission-derivation rules or creating a new public adapter.

`items_insertChangeNotice` is retained. It only creates a new Draft header, stamps the tenant and creator through dispatch, and has no existing engineering state or release transition to bypass. `items_deleteChangeNotice` is also retained with its existing transactional cleanup and explicit `parts:delete` OAuth/API-key protections.

Repository searches found no approved in-repository consumer of the six blocked raw writers through the generic API, MCP, agent, or workflow surfaces. Browser routes continue to import the service functions directly, so their guarded lifecycle and release behavior is unchanged. Guarded Impact adapters and existing task adapters remain published; raw Impact operations and task mutators remain blocked.

## Allowlist

- [x] Add exactly six unsafe writer names to `MCP_BLOCKED_TOOL_NAMES`.
- [x] Regenerate the committed manifest digest with `pnpm run generate:mcp`.
- [x] Add metadata and shared-dispatch regressions, including forged actor/tenant fields and the no-service-call assertion.
- [x] Complete focused verification and record results below.

No service, registry, authentication, route, schema, database, or Impact adapter changes are in scope.

## Manifest arithmetic

- Before: 1497 operations.
- After: 1491 operations.
- Removed: the six names listed above.
- Expected retained Change Notice writers: `items_insertChangeNotice` and `items_deleteChangeNotice`.

## Exclusions

This slice does not modify reconciliation callers, source-deletion wrappers, draft-cleanup logic, route guards, UI, task deletion, schema/RLS/database files, translations, or Slice 6C.3B/6C.3C/6D.

## Verification record

- `pnpm run generate:mcp` produced 1491 tools. A second generation through the typecheck dependency was deterministic.
- The digest comparison found exactly six removed operations, no additions, and no changes to retained operation metadata.
- Focused API/MCP tests passed: 3 files, 78 tests. The manifest route tests also passed: 1 file, 11 tests.
- `pnpm run check:manifest` passed with 1491 operations across 15 modules.
- `pnpm exec turbo run typecheck --filter=@carbon/api` passed.
- `pnpm exec turbo run typecheck --filter=erp` passed.
- Targeted Biome checks passed with no fixes applied. `git diff --check` passed.
- `pnpm run build:erp` passed. Rolldown reported a pre-existing invalid pure-annotation warning in `@daybrush/utils`; it did not fail the build.
- The final index is empty. The only tracked changes are the blocklist, digest, and two focused test files; the only untracked file is this plan.
