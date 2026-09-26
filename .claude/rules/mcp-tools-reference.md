---
paths:
  - "apps/erp/app/routes/api+/mcp+/**"
  - "packages/ee/src/mcp/**"
  - "scripts/generate-mcp.ts"
---

# Carbon ERP MCP Server

The ERP exposes an MCP (Model Context Protocol) server that wraps the module
service functions as ERP tools. The **protocol engine is commercial** — it lives
in `packages/ee/src/mcp/` (`@carbon/ee/mcp` for the pure logic —
catalog-search/describe-format/format-result/instructions/types; `@carbon/ee/mcp.server`
for `server.ts`, which embeds the `requireEntitlement("MCP")` lock). The **dispatch,
tool manifest and generated metadata stay in the app** under
`apps/erp/app/routes/api+/mcp+/` (they derive from `~/modules/*` and cannot move
into a package) and are INJECTED into the engine as `deps` by the thin route
(`_index.ts`): `{ callOperation, operationsByName, isListOperation, isMcpBlockedTool,
catalogSearch, toolMetadata }`.

> Don't recreate the old per-tool dump — it goes stale instantly (it still listed
> `inventory_getShelf`, removed when `shelf` was renamed to `storageUnit`). The
> live tool list is `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`;
> `describe_tool` / `search_tools` read from it at runtime.
>
> That manifest is **gitignored build output** (1.9 MB, rewritten wholesale on every
> run — it churned 250+ commits). It is produced by `pnpm generate:mcp`, which runs
> from `postinstall` and as the turbo root task `//#generate:mcp` that `typecheck`,
> `build` and `test` depend on — so a fresh clone regenerates it before anything
> imports it. The committed record of the published contract is its small companion
> `tool-manifest.digest.json`: one line per operation carrying classification,
> permission, injectAuth, argument count and a hash of the schema, so a contract
> change is still one visible line in review. `pnpm check:manifest` regenerates and
> fails if the digest is stale; pre-commit runs it when a service, models or
> generator file is staged.

## Endpoint & transport

- Route: `POST /api/mcp` (`api+/mcp+/_index.ts`). `loader` rejects non-POST (405);
  `OPTIONS` → 204 with CORS. JSON-RPC over
  `WebStandardStreamableHTTPServerTransport` (`enableJsonResponse: true`,
  `sessionIdGenerator: undefined` — stateless, no session).
- A fresh `McpServer` (`await createMcpServer(ctx, today, deps)` from
  `@carbon/ee/mcp.server`) is built per request and connected to a fresh transport.
  It is async because it `await requireEntitlement("MCP")` first.

## Public discovery endpoints (unauthenticated)

Three GET routes let an agent or registry find and connect to the server without
a credential. All derive their URLs from `getAppUrl() || url.origin`, so a
self-hosted / ITAR instance advertises its OWN endpoint — never hard-code
`app.carbon.ms`.

- `GET /.well-known/mcp.json` (`routes/[.]well-known.mcp[.]json.ts` → `lib/manifest.ts`
  `buildMcpManifest(origin)`) — the MCP registry `server.json`: `remotes[]` with
  `type: "streamable-http"`, tool/module counts derived from `tool-metadata.json`.
- `GET /.well-known/oauth-protected-resource` + `/.well-known/oauth-authorization-server`
  (routes at the app root) — RFC 9728 / OAuth AS discovery for the connector flow.
- `GET /agent-setup/prompt.md` (`routes/agent-setup.prompt[.]md.tsx` →
  `lib/agent-setup-prompt.ts` `buildAgentSetupPrompt(origin)`) — an agent-facing
  markdown "connect your MCP client" doc (modeled on Cloudflare's
  `agent-setup/prompt.md`). The prose is the raw file `lib/agent-setup-prompt.md`,
  imported with Vite `?raw`; `{{MCP_URL}}` / `{{ORIGIN}}` tokens are replaced at
  request time. The template is a colocation file, NOT a route — remix-flat-routes
  only promotes `index|route|layout|page|_x|x.route` names, so a plain-named `.md`
  under `lib/` is ignored (same reason `manifest.ts` there isn't a route).

## Auth (`_index.ts` → `resolveAuth`)

Three ways in, resolved in this order:

1. **OAuth bearer** — `Authorization: Bearer <token>` where the token is **not**
   prefixed `crbn_`. The token is SHA-256 hashed (`hashOAuthSecret`) and looked up
   in the `oauthToken` table; expired/missing → 401. On hit, a user-scoped client
   is minted via `getUserScopedClient(userId)`. This is the remote
   Claude/MCP-connector path (OAuth AS routes live at `_oauth+/` plus
   `[.]well-known.oauth-*` at the routes root;
   `/.well-known/oauth-protected-resource` advertises `resource: <origin>/api/mcp`,
   `scopes_supported: ["mcp:tools"]`).
2. **API key** — `Bearer crbn_…` is rewritten to the `carbon-key` header, or the
   `carbon-key` header is sent directly; falls through to `requirePermissions`.
3. **No auth** → 401 with a `WWW-Authenticate: Bearer resource_metadata=…` header
   so clients can discover the OAuth flow.

Auth always yields the app's `AuthedContext` (`../v1+/lib/base.server`; a superset
of the engine's `McpContext` in `@carbon/ee/mcp` `types.ts`). `companyId`/`userId`
come from the auth context and are injected server-side — never trusted from tool
arguments.

**Edition/plan gate (the commercial LOCK).** The MCP server is a Business+ feature.
The gate lives INSIDE the commercial engine: `createMcpServer` (`@carbon/ee/mcp.server`)
`await requireEntitlement(ctx.client, ctx.companyId, "MCP")` before building the server,
throwing `EntitlementError`, which the route catches → 402 (`makeMcpDisabledResponse`).
One check covers BOTH auth paths and blocks the **Community** edition (self-hosted) as
well as Cloud **Starter** companies. It is un-strippable — serving MCP requires executing
`@carbon/ee` code — replacing the former deletable in-route `companyHasFeature` check. The
unauthenticated discovery endpoints
(`/.well-known/mcp.json`, `/agent-setup/prompt.md`) are NOT gated — they have no company
context and only advertise the endpoint; enforcement is at `POST /api/mcp`.

## The 3 meta-tools (the ONLY tools actually registered)

To avoid context exhaustion, `server.registerTool` registers just three discovery
tools (`packages/ee/src/mcp/server.ts` (`@carbon/ee/mcp.server`)); the ~1200 ERP functions are reached through them, not
registered individually:

| Tool | Purpose |
|------|---------|
| `search_tools` | Relevance-ranked discovery (see "Catalog search" below). Filters: `query`, `module` (substring), `classification` (`READ`/`WRITE`/`DESTRUCTIVE`), `limit`/`offset`. |
| `describe_tool` | Full contract for one `name` or up to 10 `names`: description, permission scope, list-op marker, input schema AND response schema. |
| `call_tool` | Execute any ERP tool: `{ name, arguments }`. `arguments` may arrive as a JSON string and is normalized to an object. |

### Catalog search (`packages/ee/src/mcp/catalog-search.ts`, `@carbon/ee/mcp`)

`search_tools` runs BM25 full-text search via **zbsearch** (pnpm catalog dep;
in-process, index built lazily once per process over `tool-metadata.json`),
not substring filtering. The typed, tested logic lives OUTSIDE the
`@ts-nocheck` server.ts:

- Indexed fields with boosts: raw `name` (4), camelCase-split `tokens` (3),
  `description` (1.5), schema property names `fields` (0.5) — so a query can
  find a tool by a field it accepts (`unitPrice`). Prefix expansion is on;
  when a query matches nothing, a second pass runs with `tolerance: 1`
  (typo forgiveness) — the engine can't do both at once.
- `SEARCH_ALIASES` expands domain abbreviations ADDITIVELY before the index
  is queried (`rma`→return, `po`→purchase order, `shelf`→storage unit,
  `bom`→method material, …). Curate it there; the original token always
  still participates.
- `module` keeps substring semantics ("sale" matches "sales") by resolving to
  concrete names for the enum `where` filter. Filter-only calls (no `query`)
  bypass the index and keep metadata order.
- Output is one line per tool — `name [READ] (requiredParams, +N optional)`
  (`formatParamSummary`, `packages/ee/src/mcp/describe-format.ts`); the description line only
  renders when it differs from the name-derived text
  (`deriveNameDescription`). `describe_tool` output (`formatToolDescription`)
  adds `Permission:` and, for list ops (`isListOperation`), the default page
  size, plus the compact response schema when the generator derived one.
- Server instructions live in `packages/ee/src/mcp/instructions.ts` (module list + interpolated
  `MCP_DEFAULT_LIMIT`), importable by tests without server.ts's auth/env chain.
- Pinned by `lib/catalog-search.test.ts` and `lib/describe-format.test.ts`;
  `lib/manifest.ts` carries its own copies of the meta-tool descriptions
  (pinned >40 chars by `manifest.test.ts`) — keep them in sync with
  `server.ts` by hand.

### Response formatting is token-lean BY CONTRACT (`packages/ee/src/mcp/format-result.ts`)

MCP text responses deliberately differ from the HTTP API's exact data — the
HTTP/agent/workflow callers of `callOperation` are untouched:

- `call_tool` results are COMPACT JSON with **null fields omitted** (an absent
  field means null — stated in the server instructions) via `formatMcpResult`.
  Top-level arrays are hard-capped at `MCP_MAX_ROWS` (100) with an explicit
  "… N more rows omitted" marker — the backstop for the unpaginated `get*List`
  (fetchAll) operations. A paginated read short of its total appends
  `(showing R of C rows)` from the envelope's `count`.
- **List paging splits on the manifest's `paginates` flag** (generator body
  scan for `setGenericQueryFilters(`/`.range(`, same mechanism as
  `functionBodyDeletes`; in `ManifestEntry` AND the committed digest, so a flip
  is review-visible). Of ~536 list-shaped ops, only ~127 page natively.
  - `paginates: true` (search-style `get*`): `call_tool` INJECTS the pagination
    PAIR — `limit: MCP_DEFAULT_LIMIT` (25) AND `offset: 0` — for whichever of
    the two the caller omits (flat body, `{ args: {...} }` wrapper, and the
    argless call). The pair matters: `setGenericQueryFilters` applies its
    `.range()` only when BOTH are integers, so a bare `limit` silently
    paginated nothing and an argless read returned up to PostgREST's 1000-row
    cap.
  - `paginates: false` (fetchAll `get*List`): limit/offset are INERT in the
    service — it always reads the full set (it feeds UI dropdowns). The caller's
    paging used to be silently ignored (`limit: 1` returned every row); now
    `call_tool` captures it (defaults 25/0) and pages the RESPONSE via
    `pageMcpListResult` (`format-result.ts`), with the full total in the
    "(showing R of C rows)" line. `describe_tool` says so explicitly and steers
    to the DB-side paginating sibling when one exists (`paginatingSibling`:
    `getJobsList` → `getJobs`). The full read is the service's design, not a
    regression — the DB cost is identical to every dropdown load.
- `describe_tool` prints the schema compactly, and the generator strips
  `pattern` wherever a sibling `format` exists (`stripRedundantPatterns` —
  zod's email conversion emits a ~200-char regex next to `format: "email"`).
  Pinned by `mcp-tool-metadata.test.ts` ("never publishes pattern alongside
  format") and `format-result.test.ts`.
- `search_tools` returns just the grouped list — the old how-to footer
  duplicated the server instructions and re-listed every name a second time.

### Schemas tell the caller the WHOLE contract (agent-found bug class)

Three fixes from letting a real MCP agent drive the server; all pinned by
`mcp-tool-metadata.test.ts` and `validation-issues.test.ts`:

- **Intersection extras are published.** A single-object param typed
  `(z.infer<V> & { jobId; …; createdBy }) | (z.infer<V> & { jobId; …;
  updatedBy })` used to publish the validator VERBATIM (the unanchored
  `z.infer<` match in `buildToolSchema` won first), silently dropping every
  `& {...}` extra — `jobId` (NOT NULL in the DB) was missing from
  `production_upsertJobMaterial`, `quoteId`/`quoteLineId` from
  `sales_upsertQuoteMaterial`; ~120 tools carried some form of it. Union
  branches now resolve through the intersection-aware machinery and merge
  flat: properties from every branch, required only where required in EVERY
  branch (so a create-only `Omit<…, "id">` branch demotes `id` to optional),
  auth fields stripped via `CONTEXT_PARAMS`. An `Omit<…, "field">` is honored
  too — `purchasing_insertSupplier` no longer re-publishes the `id` its
  signature refuses. The `& ({createdBy} | {updatedBy})` audit union still
  resolves to the validator verbatim by design (its extras are all injected).
- **String-encoded booleans publish their two legal values.**
  `zfd.text(z.string().transform((v) => v === "true"))` converted to a bare
  `{type:"string"}`, so JSON callers sent real booleans and got an opaque
  rejection. `validator-to-json-schema.ts` PROBES each field (parses "true" →
  `true`, "false" → `false`; nothing else in the codebase does that —
  `z.coerce.boolean()` maps "false" to `true`) and adds
  `enum: ["true","false"]`.
- **Validation errors name the fields.** oRPC's bare "Input validation failed"
  is expanded by `callOperation` from the issues on the ORPCError
  (`formatValidationIssues`, `api+/v1+/lib/validation-issues.ts`): each
  issue's dotted path + message, capped at 8. Because `.input()` compiles from
  the published schema, the fixed schemas also mean jobId-missing /
  boolean-for-string mistakes are caught at validation with a self-correcting
  message instead of surfacing as a Postgres 23502.

## How `call_tool` actually runs a tool (the canonical oRPC dispatch)

`call_tool` does **not** go back through the MCP protocol — it calls
`callOperation(name, ctx, args)` from `api+/v1+/lib/call.server.ts`, the ONE
server-side entry point shared by MCP, the in-app agent, and the workflow
dispatcher (`apps/erp/app/routes/api+/inngest.ts`). There is no separate
`direct-executor.ts` any more; it was deleted when all three callers migrated.

- `callOperation` resolves the manifest entry (`operationsByName`) and runs the
  real oRPC procedure via server-side `call()` — gate middleware included, so an
  **API-key** caller is scope-checked per operation (403 when the key lacks
  `<module>_<action>` for the company). OAuth-connector and in-process
  (`authKind: "session"`) callers skip the scope gate; RLS/role bounds them.
- The service registry lives at `api+/v1+/lib/registry.server.ts` (the 15 module
  namespaces); the arg assembly lives in `api+/v1+/lib/dispatch.server.ts`.
- **Input is validated** against the operation's own schema before dispatch.
  `router.server.ts` wires `.input(jsonSchemaInput(meta.schema))` from
  `@carbon/api/schema`, which converts the manifest's JSON Schema back to zod at
  first use (`z.fromJSONSchema`; no validator library is involved). Because
  `callOperation` runs the real procedure, this covers MCP, the agent and
  workflows as well as HTTP — a malformed payload gets a 400 naming the field
  instead of silently reaching a service. `.output()` deliberately keeps the
  pass-through `jsonSchema()`: `shapeHttpBody` rewrites the body, so a correct
  response does not match the declared response schema. The validator preserves
  unknown keys (no generated schema sets `additionalProperties: false`) and
  accepts a lone wrapper's contents sent flat, since the dispatcher does too.
- `tool-metadata.json` provides `serviceParams` (positional arg order, e.g.
  `["client", "args"]`) and `injectAuth`. The dispatch builds the positional
  arg array: `client`/`userId`/`companyId`/`companyGroupId` come from `ctx`; a
  service whose param is `db` is handed `getDatabaseClient()`; payload params are
  stamped with auth fields via `enrichWithAuthContext` (now in
  `dispatch.server.ts`) — including `userId` when the payload itself declares one
  (the edge-function wrappers), which the manifest marks via `injectAuth` and the
  generator derives from the signature. Without it the service runs with no acting
  user; `apps/erp/test/mcp-tool-auth-injection.test.ts` guards the pairing.
  A param literally named `args` is stamped too, and which wire shape it takes
  is read off the operation's schema: a declared `args` object means the body
  wraps it (`{ args: {...} }`) and the inner object is unwrapped; a flat schema
  means the body already IS the args object. Both directions have a compatibility
  path, and they are NOT symmetric:
  - A wrapped schema also accepts the wrapper's contents sent flat, but only when
    the wrapper is the schema's **sole required property** (`compileSoleWrapper`
    in `packages/api/src/schema.ts`). An operation that requires `args` alongside
    another property rejects a flat body at validation, before dispatch.
  - A flat schema also accepts a lone `{ args: {...} }` envelope, unwrapped in
    `callOperation` before validation because the published instructions taught
    that shape.

  A param the schema declares as a **scalar** is passed `undefined` when no key
  matches rather than being handed the whole payload object — that fallback made
  `deleteApiKey` run `.eq("id", {...})` and return `200 null`. Reading a key by
  the param's own name is likewise gated
  (`addressesWholeParam`): a service whose sole payload param is a destructured
  object can share its name with one of that object's FIELDS —
  `insertNote(client, note: { note, documentId, … })` — and reading `body.note`
  there handed the service the note STRING instead of the record. The schema
  decides: a wrapper op declares one property named for the param, so read it; an
  op listing the param's own fields is describing it, so pass the whole body.
  `_operation` and any property that is itself another serviceParam (`args`, and
  scalar siblings like `locationId`) don't count toward that, since each is
  addressed on its own pass. When a payload param is an **array** of rows,
  `enrichWithAuthContext` stamps `createdBy` into each element (insert only) —
  the top-level stamp never reached inside, so a NOT NULL `createdBy` on the row
  table (e.g. `quoteLinePrice`) used to fail. `createdBy` is the only key ever
  ADDED to an element (element keys spread straight into an INSERT). But an
  identity key the CALLER supplied — `createdBy`, `updatedBy`, `companyId`,
  `companyGroupId` — is always OVERWRITTEN with the authenticated value, in
  top-level array elements, in objects nested one level inside an object
  payload (`{ itemUpdate: {...} }`), and in array elements one level down
  (`{ lines: [...] }`), on every operation including reads (where it can only
  narrow to the caller's own company). `userId` is deliberately NOT
  overwritten inside rows — there it is usually data (the assigned employee).
  Anything deeper (an array inside a nested object) is NOT reached, so a
  service must not spread such a structure into a write. Pinned by
  `dispatch-parity.test.ts` h, h3, h3b, h4. A Kysely service takes
  `companyId`/`userId` as POSITIONAL params so they always come from context
  (h2 — `updateQuoteLineOrder(db, companyId, userId, quoteId, updates)`).
- Blocked tools (`lib/mcp-blocked-tools.ts`, `MCP_BLOCKED_TOOL_NAMES`) are
  rejected in `call_tool`, in `callOperation`, and (belt-and-braces) in the
  `gate()` middleware — though the primary gate is that the generator excludes
  them from the manifest entirely. Tenant-level operations belong here:
  `settings_insertCompany` and `settings_deleteSubsidiary` are both bare
  `company` writes whose only scoping is a companyId the dispatcher fills from
  the caller's own key, so an empty body would create or destroy a tenant. Their
  "internal users only" gate lives in the settings ROUTE (`isInternalEmail`),
  which no API/MCP call passes through. So do operations whose table carries
  **user-scoped RLS** (`"createdBy"::uuid = auth.uid()` — `note`,
  `maintenanceDispatchComment` and the six `*Favorite` tables, migration
  `20260228000000_rls-refactor-3.sql`). An API key authenticates with the
  `carbon-key` header rather than a Supabase JWT, so `auth.uid()` is NULL and the
  predicate never matches. The failure splits by verb, and the silent half is the
  reason these are blocked rather than left to fail: an INSERT raises a visible RLS
  error, but an UPDATE/DELETE matching zero rows is not an error — PostgREST
  returns success, so `deleteNote` answered `200` while the row stayed untouched.
  `*_upsertMaintenanceDispatchComment` and `shared_insertNote` are deliberately NOT
  blocked: their INSERT path is companyId-scoped and works. The upserts' `update`
  branch still no-ops silently — making it work is an RLS decision, not an app-code
  one.
- **A thrown service error is mapped to a 422 carrying its message** by the
  `mapThrownErrors` middleware (`lib/base.server.ts`), composed ahead of `gate`
  in `router.server.ts`. Services are meant to return the Supabase
  `{ data, error }` envelope, but ~51 of them `throw` instead; oRPC rewrites any
  non-`ORPCError` throw to a 500 and keeps the message only as `cause`, which the
  encoder drops — so HTTP answered a bad id opaquely while MCP showed the real
  text (`callOperation` reads `err.message` itself). Classification is by
  constructor, since the ERP service layer has no domain-error class: a plain
  `Error` is surfaced, while `TypeError`/`ReferenceError`/`RangeError`/
  `SyntaxError` keep their opaque 500 because they mean Carbon has a bug. The
  mapper must never attach `data.supabase` — `callOperation` keys its
  `Database error:` envelope off that field.
- `eliminationClient` is a **context param**, filled from `context.client` (which
  is what the service itself defaults it to). Left out of the generator's
  `CONTEXT_PARAMS` it became a required field a caller cannot express — a
  Supabase client — so the two consolidated-balance ops failed every call.
- Supabase query builders returned by services are awaited and the
  `{ data, error, count }` envelope is **unwrapped by the dispatch**:
  `callOperation` returns `{ success: true, data, count? }` or
  `{ success: false, error, errorKind: "database" | "execution" }`. The raw error
  rides on `ORPCError.data.supabase`, and the two surfaces treat it differently:
  - `CallResult.error` (MCP, the in-app agent, workflows) carries a **fixed
    message from the closed set** in `api+/v1+/lib/database-errors.ts` —
    `conflict`, `reference`, `required`, `permission`, `notFound`, `rule`,
    `unknown`. `classifyDatabaseFailure` picks one from STRUCTURED fields only
    (a Postgres SQLSTATE, or the `FunctionsHttpError` name); message text is never
    parsed, since parsing it would make the public string a function of the private
    one. It used to interpolate `JSON.stringify(error)`, which handed a caller the
    column, constraint and value out of the PostgREST body, and later an edge
    function's own text — CWE-209 either way.
  - The **full detail is logged** instead (`logger.error("Operation failed", …)` in
    `call.server.ts`) with the operation name, the classification, the raw Supabase
    error, and — for an edge function — the message read off the unread `Response`
    on `error.context` by `edgeFunctionMessage`. Without that read the log would
    hold an empty `{"name":"FunctionsHttpError","context":{}}` rather than the rule
    that fired ("The process is not batchable"), so a business-rule rejection and a
    malformed payload would be indistinguishable in the log too.
  - **HTTP is a separate path and is unchanged**: a 400 body is serialized from the
    `ORPCError` by the oRPC handler, never from `CallResult`, so HTTP callers still
    receive the Postgres `code`/`details`/`hint`. Narrowing that is a separate
    decision about the public API.

  The consequence is deliberate and worth knowing when debugging an agent: a
  business rule an agent could act on ("already in a batch") now reads as the
  generic `rule` message, and the specific cause is in the server log. An
  enumerated code returned by the edge functions themselves, mapped to public
  strings here, is the way to give that back without echoing server text.
- The dispatch behavior is pinned by
  `api+/v1+/lib/dispatch-parity.test.ts` (golden cases carried over from the
  deleted `executeFunction`) — a change there is a behavior change for MCP,
  the agent, workflows and HTTP at once.

## Tool metadata & the generator (`scripts/generate-mcp.ts`)

`tool-metadata.json` is **generated**, never hand-edited. Run
`npx tsx scripts/generate-mcp.ts`; it parses every `apps/erp/app/modules/*/*.service.ts`
(falling back to the `.ee`-licensed `<module>.ee.service.ts` — e.g. `accounting`),
plus an optional server-only companion `<module>.mcp.server.ts` when present (for MCP
functions that must import `*.server` modules — see the gotcha below — e.g.
`production.mcp.server.ts`; the registry (`api+/v1+/lib/registry.server.ts`) merges its
exports into the same module namespace), and writes `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`
(`{ generated, totalTools, modules, tools }`). Each tool entry:
`{ name, module, classification, description, paramCount, serviceParams, injectAuth, schema }`.

- **Classification** (`classifyFunction`): `delete*` → `DESTRUCTIVE`;
  `get|list|fetch|search|find|count|check|is|has*` → `READ`; a WRITE whose
  **body issues a delete** (`.delete(` / `.deleteFrom(`, detected by
  `functionBodyDeletes`) → `DESTRUCTIVE` too — a delete-and-reinsert `upsert*`
  (e.g. `upsertQuoteLinePrices`, `replace*Steps`, favourite toggles) is
  destructive-by-omission and the client must treat it as such; everything else →
  `WRITE`. Drives the MCP annotations (`READ_ONLY_/WRITE_/DESTRUCTIVE_ANNOTATIONS`
  in `packages/ee/src/mcp/types.ts`).
- **Description** precedence: a function-level **JSDoc** on the service export
  (first sentence, `@tag`s stripped, trailing period removed, leading letter
  lowercased unless it starts an acronym, capped ~160 chars —
  `extractJsdocSummary` in `scripts/lib/service-metadata.ts`) beats the
  `DESCRIPTION_OVERRIDES` table, which beats the de-camelCased name
  (`generateDescription`). ~130 services already carry one. Descriptions flow
  to the public OpenAPI `summary` and the docs pages (which capitalize and
  append a period — hence the normalization), and are NOT part of the digest,
  so a description change is invisible in review by design. Pinned by
  `apps/erp/test/mcp-jsdoc-description.test.ts`.
- **injectAuth** (`computeInjectAuth`): keyed off the **name verb, not the
  classification** — only `READ` takes `["companyId"]`. `upsert|create|insert|
  add|new|copy|duplicate|generate*` → `["companyId","createdBy","updatedBy"]`;
  `update|set|sync|run|…*` → `["companyId","updatedBy"]`; anything else (incl. a
  genuine `delete*`) → `["companyId"]`. A DESTRUCTIVE-classified `upsert*` still
  inserts rows, so it keeps its `createdBy` — the label is only a caller hint.

- **`_operation`** (`usesOperationDiscriminator`): a tool whose service picks
  insert-vs-update by testing for an audit field on the payload gets a **required**
  `_operation: "create" | "update"` in its schema — the schema is the only marker,
  there is no parallel metadata flag. **BOTH discriminator directions count**:
  `if ("createdBy" in …)` (create-branch first, e.g. `upsertQuoteOperation`) AND
  `if ("updatedBy" in …)` (update-branch first, e.g. `upsertQuoteMaterial`,
  `upsertJobMaterial`, `upsertJob`, `upsertProductionQuantity`, `upsertPartner`,
  `upsertPeriodCloseTaskDefinition`). The generator only matched `"createdBy" in`
  until it was broadened — so the inverted ones shipped WITHOUT `_operation`, and
  since `enrichWithAuthContext` always stamped `updatedBy`, their `"updatedBy" in`
  test was always true: every create was forced down the UPDATE branch, matched
  zero rows for a fresh id, and returned **PGRST116** — a silent no-op the customer
  hit trying to add quote/job materials over the connector. (A few — `upsertJobOperation`,
  `upsertContractor`, `upsertGaugeCalibrationRecord` — got `_operation` anyway from
  a secondary `"createdBy" in` in the body, but were broken the same way until the
  dispatch fix below, because their PRIMARY branch is `"updatedBy" in`.)
  The dispatch (`api+/v1+/lib/dispatch.server.ts`) strips `_operation` from the args
  (top level *and* the `{ args: {...} }` wrapper) before building the payload, then
  stamps audit fields **symmetrically**: on `"create"` it stamps `createdBy` and
  **suppresses `updatedBy`**; on `"update"` it stamps `updatedBy` and **suppresses
  `createdBy`** — so either convention lands on the branch the caller asked for, and
  the create path matches the create-variant service type / UI insert (createdBy, no
  updatedBy). With no `_operation` (operation `undefined`) both audit fields are
  stamped, as before. Missing/invalid `_operation` on such a tool is rejected before
  the service is called; `call_tool.arguments` is `z.any()`, so the dispatch is the gate.
  Pinned by `dispatch-parity.test.ts` (cases o/p/q) and `mcp-tool-metadata.test.ts`.

## The 15 modules (current `tool-metadata.json`)

`account` · `accounting` · `documents` · `inventory` · `invoicing` · `items` ·
`people` · `production` · `purchasing` · `quality` · `resources` · `sales` ·
`settings` · `shared` · `users`. Each maps 1:1 to a
`apps/erp/app/modules/<module>/<module>.service.ts` namespace.

<!-- UNVERIFIED: exact per-module/total tool counts (~1200) drift on every regen — read tool-metadata.json for the live number, don't trust a hardcoded count. -->

## File uploads (two-step, signed-URL)

MCP `call_tool.arguments` is JSON only — there is **no binary channel** — so file
uploads are a two-step, presigned-URL flow. Step 1 is a per-module tool that mints a
folder-scoped signed upload URL; the agent PUTs the bytes straight to Supabase
storage; step 2 registers the `document` metadata row. File bytes never pass through
the model context or the MCP dispatch.

- **Step 1 (per module):** `production_createJobDocumentUploadUrl`,
  `items_createItemDocumentUploadUrl`, `sales_createOpportunityDocumentUploadUrl` /
  `…OpportunityLineDocumentUploadUrl`,
  `purchasing_createSupplierInteractionDocumentUploadUrl` / `…LineDocumentUploadUrl`,
  plus the generic escape hatch `documents_createDocumentUploadUrl` (takes a raw
  `folder`/`entityId` for entities without a dedicated wrapper — Issue, Shipment,
  Gauge, …). Each returns `{ path, token, signedUrl }`. Per-module because an
  opportunity's **storage-folder id (`opportunityId`) differs from its
  `sourceDocumentId`** (the quote/order id), so a generic `sourceDocument`-keyed tool
  cannot reconstruct the folder path. Backed by `documents.service.ts`
  `createDocumentUploadUrl` → `client.storage.from("private").createSignedUploadUrl`;
  the shared path convention is `buildDocumentUploadPath` in `documents.models.ts`
  (`${companyId}/${folder}/${entityId}/${stripSpecialCharacters(name)}`).
- **Step 2:** `documents_insertUploadedDocument` — wraps `upsertDocument`, defaulting
  `readGroups`/`writeGroups` to the creating user and taking `size` in **KB**. Pass
  the step-1 `path` plus the entity's `sourceDocument` (enum) + `sourceDocumentId`.
- **Auth:** works on the **OAuth-connector path** (user-scoped client → storage RLS
  passes). The `carbon-key` API-key path is not a Supabase JWT (`auth.uid()` is null),
  so the `private` bucket's storage RLS will refuse the signed-URL mint — same class
  of limitation as the blocked note-table tools. OAuth is the supported path.

## Gotchas

- The generator reads a service's **parameter list textually**, but resolves more
  shapes than it used to. An **inline** array-of-objects
  (`prices: { quantity: number; ... }[]`) now publishes as a typed
  `{"type":"array","items":{...}}`; a `z.infer<typeof V>` validator param resolves
  `V.merge(z.object({...}))` / `applyX(...)` wrappers / referenced `*Validator`s
  (same models file) into real fields; and an `errorMap: () => (...)` inside a
  validator no longer truncates the fields after it. A `z.infer<typeof V>`
  **nested inside an inline object type** also resolves — bare, `Partial<...>`,
  `PickPartial<..., "k">` (listed keys turn optional), `Omit<..., "k">`, an
  indexed access (`z.infer<...>["lines"]`), and an `& { ... }` intersection —
  as do parenthesized discriminated-upsert union branches
  (`(Omit<z.infer<...>> & {...}) | (...)`). Also resolved:
  `Database["public"]["Enums"][...]` (real value enums) and
  `Database["public"]["Tables"][t]["Row"|"Insert"|"Update"]` (real columns,
  auth-injected fields stripped) via `scripts/lib/db-types.ts` over the
  generated types; `Array<T>`/`ReadonlyArray<T>`/`Record<string, V>`/
  `Partial<X>` generics; general `A & B` intersections; `(typeof x)[number]`
  const arrays (real values when the registry has them); and bare **type
  aliases declared in the module's own sources** (service file, `types.ts`,
  models, and the shared equivalents). This matters on WRITE tools: an untyped
  `{}` invites an MCP client to guess field names, and a guessed
  `contact.phone` reached the insert and failed with PGRST204 (pinned by
  `apps/erp/test/mcp-tool-metadata.test.ts`). Still opaque, deliberately:
  compiler-derived types (`ReturnType`/`Awaited`), aliases imported from other
  packages, `Map<...>` params, and genuine `Json`/`unknown`/rich-text fields.
  Keep `//` comments above the function, not inside the parameter list (a
  comment there is parsed as a property name).
- A service whose first parameter is `db` (a Kysely transaction client) is served
  `getDatabaseClient()` by `dispatch.server.ts`, the same way `client` is served
  the supabase one. A first parameter named anything else falls through to the
  positional-argument branches and receives a business argument as its client.
- Don't enumerate individual tools in docs — `search_tools` is the source of truth.
  Names follow `<module>_<verb><Entity>` (e.g. `sales_getCustomers`,
  `inventory_upsertStorageUnit`).
- "Shelf" was renamed to **storage unit**: use `inventory_*StorageUnit*`, not
  `getShelf` (which no longer exists). "Shelf life" (`*ShelfLife*`) is a
  *different*, still-current concept — don't conflate them.
- To block a tool from MCP, add its `<module>_<func>` name to
  `MCP_BLOCKED_TOOL_NAMES` and regenerate metadata.
- **A `{module}.service.ts` must not import a `*.server` module** (`@carbon/auth/users.server`,
  `@carbon/ee/rules.server`, an app `*.server.ts`, …) — even via `await import(...)`.
  The module barrel (`~/modules/{module}`) re-exports the service, and client components
  value-import that barrel for validators/enums, so the service is in the **client** bundle;
  React Router's `react-router:dot-server` plugin then fails the build with *"Server-only
  module referenced by client"*. Put such MCP write functions in a server-only companion
  `{module}.mcp.server.ts` instead (never re-exported by the barrel). The generator parses it
  and `registry.server.ts` spreads its exports into the module namespace, so the tool names and
  metadata are identical to a service-file function. Precedent: `production.mcp.server.ts`
  holds `issueMaterial` / `completeJob`.
- **A same-named `{module}.mcp.server.ts` export SHADOWS the service function** —
  the generator dedupes by name (mcp wins, matching the runtime registry spread),
  so an orchestration wrapper can replace a bare service function without
  renaming the published tool. Precedent: `upsertJobMaterial` — the ROUTES run
  the requirements recalc themselves (`recalculateJobMakeMethodRequirements`,
  which fills `estimatedQuantity`; the generated `quantityToIssue` derives from
  it), so a connector call to the bare service left every imported material at
  estimatedQuantity 0 and issue/picking pulled nothing. The wrapper mirrors both
  routes' orchestration (MTO method pull on transition, recalc released creates /
  all updates) and keeps the exact service payload type so the published schema
  hash is unchanged. Body scans (classification, `_operation`) read the FIRST
  match in the concatenated content — the service body — so a wrapper must keep
  the same discriminator convention as the function it shadows. Pinned by
  `mcp-upsert-job-material.test.ts` and the "registers a shadowed mcp.server
  function exactly once" case in `mcp-tool-metadata.test.ts`.
