# @carbon/operations

The Node home of the former Supabase edge functions: one directory per operation
(`src/<former-function-name>/`), called in-process from ERP/MES routes, services,
the API and Inngest jobs instead of through `client.functions.invoke`. The move
is tracked in `.ai/plans/2026-09-28-remove-edge-functions.md`.

## Always

- MUST take an `OperationContext` (`{ db, client, companyId, userId, system? }`)
  as the first argument. The caller builds it: `db` from `getDatabaseClient()`
  (ERP/MES `~/services/database.server`) or `getJobDatabaseClient()` (jobs),
  `client` the service role. Never construct a pool or client in this package.
- MUST check the caller first thing: `assertOperationPermissions(ctx, { <action>:
  "<module>" })` with the same permissions the edge function passed to
  `requirePermissions`, or `assertSystemCaller(ctx)` when only servers call it.
  `operation-authorizes-caller` (`@carbon/checks`) fails an operation that does
  neither.
- MUST re-read record ids from the input under `companyId` before writing
  (`assertCompanyRecords`), as the edge functions did.
- MUST return `OperationResult` via `runOperation(name, body)`. Its `error.message`
  is empty for data-layer failures, so callers keep their
  `getEdgeFunctionErrorMessage(error, fallback)` copy.
- MUST be imported lazily (`await import("@carbon/operations/<name>")`) from a
  `*.service.ts`: service files are bundled for the browser, and this package
  reaches `.server` modules. Routes, `.server.ts` files and jobs import statically.

## Never

- Never set `ctx.system` from request input. It is the service-role bearer's
  counterpart: jobs and syncers only.

## Validation Commands

```bash
pnpm --filter @carbon/operations test
pnpm exec turbo run typecheck --filter=@carbon/operations --concurrency=1
pnpm --filter @carbon/checks test
```

## Key Exports

| Subpath | Provides |
|---|---|
| `.` | `OperationContext`, `assertOperationPermissions`, `assertSystemCaller`, `hasPermissions`, `runOperation`, `OperationError`, `assertCompanyRecords`, `RecordNotFoundError` |
| `./<name>` | one operation (`src/<name>/index.ts`) |
