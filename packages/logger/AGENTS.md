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
  puts `{ requestId }` into implicit context, so every server log during a
  request carries it. Read it with `getRequestId(context)` from
  `@carbon/logger/middleware.server`, or `getRequestId()` with no argument from
  a plain service function (resolved via `requestContextMiddleware`'s scope).
- Request-scoped memoization: `oncePerRequest(key, fn)` computes once per HTTP
  request; `oncePerRead(key, fn)` does the same but ONLY on GET/HEAD/OPTIONS.
  Use `oncePerRead` for anything derived from database state — React Router runs
  an action and its loader revalidation in one request, so a plain memo there
  would serve pre-write data. `oncePerRequest` is for values that are not
  database state (e.g. a Supabase client).
- Request-body logging is **debug-only** and guarded: `requestIdMiddleware`
  captures the body onto the access-log record's `body` prop **only** when
  `LOG_LEVEL=debug` (skipped entirely at the prod `info` default — no clone, no
  parse). It covers `POST/PUT/PATCH/DELETE` with `application/json` or
  `application/x-www-form-urlencoded` bodies at/under 8KB (`content-length`
  required); multipart uploads, oversized, and unknown-length bodies log a short
  marker instead. Sensitive fields (`password`/`token`/`secret`/… — the
  `REDACT_FIELD_PATTERNS` set in `src/redaction.ts`) are masked `[REDACTED]` in
  the captured object. That set is LogTape's `DEFAULT_REDACT_FIELDS` minus
  `email`/`phone`/`address` — ordinary ERP business data stays visible, and the
  prod sink MASKS matched fields rather than deleting them (a deleted key once
  made a PGRST204 failure unreconstructable from the log line). The body is read
  from a clone, so the route handler's stream stays intact.

## Ask First

- Changing the sink/formatter setup in `config.server.ts` / `config.client.ts`
  (affects every log line's shape — dev ANSI vs prod JSONL + field redaction).
- Changing the category root or the `LOG_LEVEL` default derivation.
- Adding a new log sink target (file, OTEL logs, Sentry) or a new trace exporter —
  these change deploy shape.

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
| `./middleware.server` | `requestMiddleware` (context + id + access log in one), `requestIdMiddleware`, `requestIdContext`, `getRequestId`, `REQUEST_ID_HEADER`, plus the request-context API re-exported from `context.server`: `requestContextMiddleware`, `getRouterContext`, `getRequestContext`, `oncePerRequest`, `oncePerRead` |
| `./tracing.server` | `createTracing({ serviceName, afterRequest })` — React Router `instrumentations` (OpenTelemetry); `annotateRequestSpan(attributes)`; `nameRequestSpan(name)`; `timedMiddleware({ name: fn })`; `withSpan(name, attributes, run)`; `queryLog` — Kysely `log` hook, `undefined` when tracing is off |
| `./inngest` | `createInngestLogger()` — adapter passed to `new Inngest({ logger })` |

## Wiring (per app)

- `entry.server.tsx`: `import { ensureLoggingConfigured } from "@carbon/logger/config.server"; ensureLoggingConfigured();` at top.
- `entry.client.tsx`: same from `@carbon/logger/config.client`.
- `entry.server.tsx` also exports
  `instrumentations = createTracing({ serviceName: "carbon-erp", afterRequest })`.
- `root.tsx`: `export const middleware = timedMiddleware({ request: requestMiddleware, security: securityMiddleware, flash: flashMiddleware })` — `requestMiddleware` is the request scope in one middleware (context + request id + access log)
  (request context FIRST so every downstream middleware and handler runs inside
  the AsyncLocalStorage scope, then request id so downstream logs carry it).

## Tracing (OpenTelemetry)

`src/tracing.server.ts`. **Off unless enabled**: with no
`OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`),
`createTracing` returns `[]`, no provider or fetch
instrumentation is registered, `queryLog` is `undefined` so Kysely installs no
hook, and `annotateRequestSpan` returns immediately. The library code is loaded
but nothing in it runs.

Nothing here is specific to a vendor or host. Configuration is the standard OTel
variables, read by the exporter and SDK themselves, so any OTLP backend works:

```bash
# Axiom — the host is your Axiom edge domain (api.axiom.co is the US default)
OTEL_EXPORTER_OTLP_ENDPOINT="https://api.axiom.co"
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer%20<api-token>,X-Axiom-Dataset=<dataset>"
# optional
OTEL_SERVICE_NAME="carbon-erp"                     # default: the app's serviceName
OTEL_RESOURCE_ATTRIBUTES="deployment.environment.name=production,service.version=<sha>"
OTEL_TRACES_SAMPLER="parentbased_traceidratio"     # default: every request
OTEL_TRACES_SAMPLER_ARG="0.1"
```

One trace per request:

- **Request span** (`SERVER`) — named by method until a route handler reports the
  matched pattern, then `GET /x/part/:itemId/details`. Carries `http.route`,
  `url.path`, and — set by `requestIdMiddleware` through `annotateRequestSpan` —
  `http.response.status_code` and `carbon.request_id` (the id on every log line
  of that request). React Router 7.18's request instrumentation reports neither
  the status nor the pattern, which is why they arrive from those two places.
  A route that serves many things on one path renames it with
  `nameRequestSpan`: `POST /api/inngest carbon-event-queue`,
  `POST /api/mcp call_tool sales_getCustomers`, `POST /api/v1/sales/getCustomers`.
  Only known function ids and operations go into the name; the same values are
  on `inngest.function.id` / `carbon.operation` for grouping.
- **`loader|action <routeId>`** spans, one per route handler. Middleware get
  no span: a middleware span contains everything after it, so it read as slow
  whenever a loader was. The apps wrap the root list in
  `timedMiddleware({ name: fn, ... })`, which records each middleware's OWN
  time on the request span as `carbon.middleware.<name>.ms` (its total minus
  the time in what it calls next). Named by key, not `fn.name`: the production
  build minifies function names.
- **Fetch spans** from `@opentelemetry/instrumentation-undici`, only for fetches
  made inside a request (`requireParentforSpans`). `fetchSpanName` names a
  Supabase call by what it does — `GET /rest/v1/methodMaterial`,
  `storage download`, `auth GET user`, `function get-method` — and anything else
  by host. Names never carry ids, bucket names or file paths; those are on
  `url.path`. `url.full` and `url.query` get the access log's `redactSearch`
  masking.

- **Operation spans**, from `withSpan`. Every Carbon API operation runs through
  its oRPC procedure (`api+/v1+/lib/router.server.ts`), whose outermost
  middleware opens `operation sales_getCustomers` — so the HTTP API, MCP
  `call_tool`, the agent and workflows are all named in one place. The MCP
  server (`@carbon/ee/mcp.server`) wraps `registerTool` to open
  `mcp call_tool sales_getCustomers` / `mcp search_tools` around each tool call.
  Both also set `carbon.operation` (and `carbon.mcp.tool`) on the request span,
  so a request can be grouped by what it ran without joining spans.

- **Query spans** for Kysely, from `queryLog` passed as Kysely's `log` hook at
  the three places a client is built (`apps/{erp,mes}/app/services/database.server.ts`,
  `packages/jobs/src/db.ts`, through `getPostgresClient`'s third argument). Named
  `SELECT item` / `INSERT jobMaterial` — the verb and the first quoted table —
  with the SQL in `db.query.text`. Bound parameter values are never recorded.
  Kysely reports a query after it ran, so the span is back-dated by the measured
  duration, which covers the query but not the wait for a pooled connection, and
  `BEGIN`/`COMMIT` are not reported at all.

Not traced: Redis, and anything that talks HTTP through Node's `http` module
rather than `fetch`. That time shows up inside the enclosing loader or action span.

The batch is exported on a timer (every 5 s by default, `OTEL_BSP_*` to tune).
A host that suspends the process once a response is sent would strand it, so
`createTracing` takes an optional `afterRequest(flush)`; the apps pass one only
when `VERCEL` is set, handing the flush to `waitUntil` from `@vercel/functions`.
That host-specific line lives in each app's `entry.server.tsx`, not here.

## Cross-References

- `packages/lib/src/inngest/client.ts` — consumes `createInngestLogger()`.
- `packages/database/supabase/functions/lib/logging.ts` — Deno-native twin
  (`getFunctionLogger`), configured from `jsr:@logtape/*`.
- `packages/env/` — defines `LOG_LEVEL` (also exposed to `window.env`).
