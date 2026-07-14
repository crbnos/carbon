# @carbon/logger

Centralized, isomorphic logger built on [LogTape](https://logtape.org). Works in
browser, Node (SSR + Inngest jobs), and — via a separate self-contained copy —
Deno edge functions. Replaces raw `console.*`. Structured records, hierarchical
categories, env-driven levels, and cloud-agnostic request-id correlation.

## Always

- Get a logger with `getLogger(...segments)` — it prepends the `carbon` root:
  `getLogger("auth")` → `["carbon","auth"]`, `getLogger("erp","sales")` →
  `["carbon","erp","sales"]`. One logger per module/area.
- Category convention: packages → `getLogger("<pkg>")`; ERP modules →
  `getLogger("erp","<module>")`; MES → `getLogger("mes",...)`; jobs →
  `getLogger("jobs","<fnName>")`; edge functions → `["carbon","edge",fnName]`
  (Deno side).
- Message + structured data: `logger.info("Created {id}", { id })` or the object
  form `logger.info("{*}", { id, companyId })`. Prefer structured properties over
  string concatenation — they survive to JSONL in prod.
- Levels: `trace | debug | info | warning | error | fatal`. `LOG_LEVEL` env
  overrides the default (dev `debug`, server prod `info`, browser prod
  `warning`).
- Request id is automatic inside loaders/actions/services: `requestIdMiddleware`
  (registered first in each app's `root.tsx`) puts `{ requestId }` into implicit
  context, so every server log during a request carries it. Read it explicitly
  with `getRequestId(context)` from `@carbon/logger/middleware.server`.
- Request-body logging is **debug-only** and guarded: `requestIdMiddleware`
  captures the body onto the access-log record's `body` prop **only** when
  `LOG_LEVEL=debug` (skipped entirely at the prod `info` default — no clone, no
  parse). It covers `POST/PUT/PATCH/DELETE` with `application/json` or
  `application/x-www-form-urlencoded` bodies at/under 8KB (`content-length`
  required); multipart uploads, oversized, and unknown-length bodies log a short
  marker instead. Sensitive fields (`password`/`token`/`secret`/`email`/… — the
  `DEFAULT_REDACT_FIELDS` set) are masked `[REDACTED]` in the captured object.
  The body is read from a clone, so the route handler's stream stays intact.

## Ask First

- Changing the sink/formatter setup in `config.server.ts` / `config.client.ts`
  (affects every log line's shape — dev ANSI vs prod JSONL + field redaction).
- Changing the category root or the `LOG_LEVEL` default derivation.
- Adding a new sink target (file, OTEL, Sentry) — these change deploy shape.

## Never

- Import `./config.server`, `./middleware.server`, or anything Node-only from
  client code. Node-only modules use the `.server.ts` suffix; the React Router
  Vite plugin errors at build if one reaches the client graph.
- Depend on `@carbon/env` from this package. `@carbon/env` throws at module load
  on missing required vars; logging must stay importable in any context. It reads
  `LOG_LEVEL` / `NODE_ENV` raw via `src/env.ts` instead.
- Log at module top level. LogTape no-ops before `configure()` runs, so
  load-time logs are dropped. Log inside functions/handlers.
- Hand-edit the Deno copy at `packages/database/supabase/functions/lib/logging.ts`
  to diverge from this package's config without reason — it mirrors this on
  purpose (edge functions can't import workspace packages).

## Validation Commands

```bash
pnpm --filter @carbon/logger typecheck
pnpm --filter @carbon/logger test
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `.` | `getLogger`, `LOG_LEVELS`, `parseLogLevel`, `CarbonLogLevel`, `Logger` type — isomorphic, safe everywhere |
| `./config.server` | `ensureLoggingConfigured()` (ANSI dev / JSONL+redacted prod, ALS) |
| `./config.client` | `ensureLoggingConfigured()` (plain console sink, no ALS) |
| `./middleware.server` | `requestIdMiddleware`, `requestIdContext`, `getRequestId`, `REQUEST_ID_HEADER` |
| `./inngest` | `createInngestLogger()` — adapter passed to `new Inngest({ logger })` |

## Wiring (per app)

- `entry.server.tsx`: `import { ensureLoggingConfigured } from "@carbon/logger/config.server"; ensureLoggingConfigured();` at top.
- `entry.client.tsx`: same from `@carbon/logger/config.client`.
- `root.tsx`: `export const middleware = [requestIdMiddleware, flashMiddleware]`
  (request id FIRST so downstream runs inside its context scope).

## Cross-References

- `packages/lib/src/inngest/client.ts` — consumes `createInngestLogger()`.
- `packages/database/supabase/functions/lib/logging.ts` — Deno-native twin
  (`getFunctionLogger`), configured from `jsr:@logtape/*`.
- `packages/env/` — defines `LOG_LEVEL` (also exposed to `window.env`).
