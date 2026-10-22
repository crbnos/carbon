---
paths:
  - "apps/erp/app/routes/api+/mcp+/**"
  - "apps/erp/app/routes/api+/v1+/lib/**"
  - "packages/ee/src/mcp/**"
  - "scripts/generate-mcp.ts"
  - "scripts/lib/service-fn-metadata.ts"
---

# Carbon ERP MCP Server

The ERP publishes its service functions (`defineServiceFn` consts in each
`apps/erp/app/modules/<module>/<module>.server.ts`, see `module-files.md`) as
MCP tools and as the HTTP API. One manifest describes both; one oRPC procedure
per operation runs both.

The **protocol engine is commercial**. It lives in `packages/ee/src/mcp/`:
`@carbon/ee/mcp` holds the pure logic (catalog search, describe/format
helpers, instructions, types) and `@carbon/ee/mcp.server` holds `server.ts`,
which embeds the `requireEntitlement("MCP")` lock. The dispatch and the
manifest stay in the app, because they derive from `~/modules/*`. The route
(`api+/mcp+/_index.ts`) injects them into the engine as `deps`:
`{ callOperation, operationsByName, isListOperation, catalogSearch, toolMetadata }`.

Don't list individual tools in docs: they go stale. `search_tools` and
`apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json` are the live list.

## The manifest

`tool-metadata.json` is **gitignored build output**, written by
`pnpm generate:mcp` (`scripts/generate-mcp.ts`, the turbo root task
`//#generate:mcp`). `postinstall` runs it for local development (skipped under
`CI`; Vercel still runs it), and the `typecheck`, `build` and `test` of `erp` and
`docs` depend on it. The task is cached on the inputs in `turbo.json`: the
module sources, the app's `types`, `utils` and `services`, the generated DB
types, `scripts/lib` and the package sources the modules' types reach
(`@carbon/ee` included: published inputs use its validators).
`apps/erp/test/mcp-manifest-cache-inputs.test.ts` fails when a models file or a
module's `<module>.server.ts` imports something those inputs do not cover.

The committed record is `tool-manifest.digest.json`: one line per operation
with its classification, permission, `paginates` and a hash of each schema, so
a contract change is one visible line in review. `pnpm check:manifest`
regenerates without the cache and fails when the digest is stale. Pre-commit
(`scripts/git-hooks/pre-commit`) runs that check when a staged file falls under
the same inputs; its path pattern mirrors the turbo list, so change both.

Each entry (`ManifestEntry`, `@carbon/api`): `{ name, module, classification,
title, description, permission, paginates, schema, responseSchema?, serviceFn }`.
`serviceFn.path` is the operation's path in the router
(`["production", "cancelJob"]`). The file also carries `companyTables`, read from
the generated DB types (generation fails if it comes back short).

## How the generator reads a service function

`buildManifest()` (`scripts/lib/service-fn-metadata.ts`) walks
`apps/erp/app/modules/router.server.ts` with ts-morph. Each module is a namespace
import of its server file, and each exported `defineServiceFn` const is a leaf;
any other value export in a server file fails generation.

- **Published**: only a leaf whose TSDoc has `@mcp`. A building block in
  `.service.ts` is never a tool.
- **Name**: `<module>_<constName>`; HTTP path `POST /api/v1/<module>/<constName>`.
  Renaming the const renames the public tool.
- **Title and description**: the summary (the doc's first paragraph) is the
  title (required), taken whole.
  The description is the summary sentence, then `@remarks`, then `@returns`.
  `@param name - text` becomes that input field's `description`, and naming a
  field the input does not have fails generation.
- **Permission**: read off the literal `permission` and published in the
  manifest. One module → `{ module, actions }`; several modules, or `{}`
  (company membership) → `{ module: null, actions: [] }`. The function's own
  gate is the only check. `"system"` and a keyed permission (`{ by, rules }`)
  cannot be published.
- **Classification**: only `view` → READ; any `delete` → DESTRUCTIVE; else
  WRITE. `@mcp read` forces READ, for a read gated on membership alone (`{}`);
  on a permission that names `create`, `update` or `delete` it fails
  generation, since a READ is offered as safe to run unasked. `@mcp destructive`
  forces DESTRUCTIVE.
- **Input schema**: the TYPE of `run`'s input parameter, through
  `typeToJsonSchema` (`scripts/lib/response-schema.ts`). A field whose type
  admits `undefined` is optional. Enum members are sorted, so the hash does not
  move with the checker's type ids. The type carries no descriptions, so
  `inputFieldDescriptions` (`scripts/lib/input-docs.ts`) reads each top-level
  field's `.describe("…")` from the source, following the validator an input
  extends; `@param` overrides it. A loose input whose `run` calls a building
  block of its module that runs `setGenericQueryFilters`
  (`appliesGenericFilters`) also publishes `filters` and `sorts`.
- **Response schema**: `run`'s return type, with `Promise` and `{ data, error }`
  peeled off. A `paged` result (`{ rows, count }`, `@carbon/api/service-tools.server`)
  is published as its rows with `paginates: true`; rows that are not a list
  fail generation.

Pinned by `apps/erp/test/mcp-service-fn-metadata.test.ts`. Permissions and
classifications across the whole manifest are pinned by
`apps/erp/test/mcp-tool-permissions.test.ts`. The workflow catalog names tools
by these names; `scripts/check-workflow-catalog.ts` fails on a name that no
longer exists.

## How a call runs

`callOperation(name, ctx, args)` (`api+/v1+/lib/call.server.ts`) is the one
server-side entry for MCP `call_tool`, the in-app agent and the workflow
dispatcher. It looks the entry up, runs its oRPC procedure with server-side
`call()`, and returns `{ success: true, data, count? }` or
`{ success: false, error, errorKind: "execution", category? }`.

The procedure (`api+/v1+/lib/router.server.ts`) is the same one HTTP serves:

1. `traced` names the span.
2. `.input(jsonSchemaInput(meta.schema))` validates against the published
   schema. Unknown keys pass. `callOperation` turns validation issues into
   one message naming each field (`formatValidationIssues`, capped at 8).
   Validation runs before the permission check, so a malformed call gets a
   400 before a 403.
3. `runServiceFn` (`service-fn.server.ts`) builds a service context from the
   caller and calls the const, whose permission gate is the one check for
   every `authKind`: an API key's scopes, an OAuth connector's user's live
   permissions in the token's company, or a workflow owner's permissions.
   The context's client is `scopedToCompany`: every update and delete on a
   company table also filters by the caller's company, so an id from the
   user's other company matches nothing.
4. A refusal (`CarbonError`) becomes an `ORPCError` with the category's code and
   status, and `data.category`. The message is the function's own; a throw
   inside `run` arrives as `internal` with the cause logged, not returned.
5. The spec (`openapi[.]json.ts`) adds every refusal beside the 200 body
   (`withErrorResponses`, `spec-options.server.ts`): a JSON `Error`
   (`{ code, status, message, data: { category } }`) from the operation, plain
   text for the API key's own 401 / 403 / 429.
6. `shapeHttpBody`: a list (`isListOperation`, an array response schema) goes
   out as `{ results, count }`, anything else as the bare value.
   `callOperation` reverses it with `unshapeHttpBody`.

## Endpoint & transport

- Route: `POST /api/mcp` (`api+/mcp+/_index.ts`). `loader` rejects non-POST (405);
  `OPTIONS` → 204 with CORS. The route authenticates, then makes one call:
  `serveMcpRequest(request, ctx, today, deps)` (`@carbon/ee/mcp.server`, MCP
  TypeScript SDK v2, `@modelcontextprotocol/server`). It awaits
  `requireEntitlement("MCP")`, then builds a fresh server for the request.
- Both protocol eras, one server definition. `isLegacyRequest` sends 2025-era
  requests (every client's default `initialize` handshake) to
  `WebStandardStreamableHTTPServerTransport` with `sessionIdGenerator:
  undefined` and `enableJsonResponse: true`, the wiring SDK v1 had: the SDK's
  own stateless fallback answers with SSE. 2026-07-28 requests go to
  `createMcpHandler(factory, { legacy: "reject", maxSubscriptions: 0 })`.
  `maxSubscriptions: 0` refuses `subscriptions/listen` in-band, because it holds
  a stream open that a per-request serverless function cannot keep, and the tool
  list never changes at runtime.
- Pinned by `packages/ee/src/mcp/server.test.ts`: an SDK client over HTTP
  against `serveMcpRequest` in each era.

## Public discovery endpoints (unauthenticated)

All derive their URLs from `getAppUrl() || url.origin`, so a self-hosted / ITAR
instance advertises its own endpoint. Never hard-code `app.carbon.ms`.

- `GET /.well-known/mcp.json` (`lib/manifest.ts` `buildMcpManifest(origin)`):
  the registry `server.json`, with tool and module counts from the manifest.
- `GET /.well-known/oauth-protected-resource` + `/.well-known/oauth-authorization-server`:
  RFC 9728 / OAuth AS discovery for the connector flow.
- `GET /agent-setup/prompt.md` (`lib/agent-setup-prompt.ts`): the "connect your
  MCP client" doc. The prose is `lib/agent-setup-prompt.md` (Vite `?raw`), with
  `{{MCP_URL}}` / `{{ORIGIN}}` replaced per request. It is a colocated file, not
  a route: remix-flat-routes ignores a plain-named `.md` under `lib/`.

## Auth (`_index.ts` → `resolveAuth`)

1. **OAuth bearer**: `Authorization: Bearer <token>` not prefixed `crbn_`.
   `findOAuthToken` (hash lookup + expiry), the per-user rate limit, then
   `oauthContext` (membership, company group, claims, user client), in
   `api+/v1+/lib/authenticate.server.ts`.
2. **API key**: `Bearer crbn_…` is rewritten to the `carbon-key` header, or the
   header is sent directly (`authenticateApiKey`).
3. **No auth** → 401 with `WWW-Authenticate: Bearer resource_metadata=…`.

`companyId` / `userId` always come from the credential, never from arguments.

**Edition/plan gate.** MCP is a Business+ feature, locked inside the commercial
engine: `serveMcpRequest` throws `EntitlementError`, which the route turns into
a 402 (`makeMcpDisabledResponse`). One check covers both auth paths, the
Community edition and Cloud Starter. The discovery endpoints are not gated.

## The 4 meta-tools

Only four tools are registered (`packages/ee/src/mcp/server.ts`); every ERP
operation is reached through them.

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
- `expandQueryTerm` also adds each word's inflection stem (`stemInflection`,
  `@carbon/content/search`: zbsearch's Porter limited to plural/-ed/-ing/-e) to the
  QUERY, never the index — "scrapping" finds the scrap tools. Stemming the index
  collapsed "orders" into "order" and ranked single-record tools above list tools;
  full Porter turned "customer" into "custom". The docs site uses the same stemmer.
- The in-app agent's `search_docs` reuses this engine over the docs corpus —
  `createDocSearch` in `packages/ee/src/mcp/doc-search.ts` shares `expandQueryTerm`
  (so a new alias improves both) and the typo retry. It indexes page SECTIONS, weights
  each page's intro ×2 via `sortBy`, and returns at most two sections per page.
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
- **List paging splits on the manifest's `paginates` flag** (the generator asks
  the function's AST whether it calls `setGenericQueryFilters` or `.range` —
  `paginates` in `scripts/lib/service-ast.ts`; in `ManifestEntry` AND the
  committed digest, so a flip is review-visible). Of ~536 list-shaped ops, only ~127 page natively.
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
  `<module>_<action>` for the company). An **OAuth-connector** caller is gated
  the same way, on scopes built from its user's live permissions in the token's
  company (`scopesFromPermissions`, `base.server.ts`). RLS cannot bound it: a
  service handed `db` writes through the direct connection, which bypasses RLS,
  so before this a connector token for a user with no accounting permission
  could write GL journals. Only the in-process workflow engine
  (`authKind: "session"`) skips the gate.
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
  `["client", "args"]`), `contextParams` and `injectAuth`. The dispatch builds
  the positional arg array from them: a param listed in `contextParams` is filled
  with the context value the manifest names (`client`, `db` →
  `getDatabaseClient()`, `userId`, `companyId`, `companyGroupId`), and the
  dispatcher recognises NO parameter name itself. It used to keep its own list,
  which lacked `createdBy`/`updatedBy` while the generator hid them from the
  schema, so `updateJobOperationStatus(client, id, status, updatedBy)` was handed
  the caller's value or the whole body and failed `jobOperation_updatedBy_fkey`.
  Pinned by `dispatch-parity.test.ts` a3. Payload params are
  stamped with auth fields via `enrichWithAuthContext` (now in
  `dispatch.server.ts`) — including `userId` when the payload itself declares one
  (the server-function wrappers), which the manifest marks via `injectAuth` and the
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
  A property that is itself another serviceParam (`args`, and
  scalar siblings like `locationId`) does not count toward that, since each is
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
  is what the service itself defaults it to): `POSITIONAL_CONTEXT` maps it to
  `client`. Left out of the generator's list it became a required field a caller
  cannot express — a
  Supabase client — so the two consolidated-balance ops failed every call.
- **A failure in the service's result is an error, whatever its shape.** A
  service does not throw; `readServiceResult` (`dispatch.server.ts`) reads the
  failure where the manifest's `resultShape` says it is. The generator takes that
  off the declared return type with the checker (`scripts/lib/result-shape.ts`,
  awaited, so a Promise and a builder returned without `await` read alike):
  `envelope` — an object with an `error` member, PostgREST's response or a
  hand-built `{ error }` with or without `data` (1,311 tools); `envelopes` — a
  list of those, a `Promise.all` of writes (15); `flag` — `{ ok | success }`
  with no `error` (2); `plain` (154). Only `{ data, error }` WITH a `data` key
  used to be read, so a bare `{ error }`, one failed write in a `Promise.all`
  and `{ ok: false }` all went back as a success. A truthy top-level `error` is
  a failure under every shape, so a service must not return a bare row that has
  an `error` column — wrap it in `{ data }`. A return type that mixes the two
  signals, or a list whose items disagree, fails generation. The digest shows
  `result` for `envelopes` and `flag`. Pinned by `dispatch-parity.test.ts` and
  `apps/erp/test/mcp-service-ast.test.ts`.
- Supabase query builders returned by services are awaited and the
  `{ data, error, count }` envelope is **unwrapped by the dispatch**:
  `callOperation` returns `{ success: true, data, count? }` or
  `{ success: false, error, errorKind: "database" | "execution" }`. The raw error
  rides on `ORPCError.data.supabase`, and the two surfaces treat it differently:
  - `CallResult.error` (MCP, the in-app agent, workflows) carries a **fixed
    message from the closed set** in `api+/v1+/lib/database-errors.ts` —
    `conflict`, `reference`, `required`, `permission`, `notFound`, `rule`,
    `unknown`. `classifyDatabaseFailure` picks one from the Postgres/PostgREST
    `code` only; message text is never parsed, since parsing it would make the
    public string a function of the private one. It used to interpolate
    `JSON.stringify(error)`, which handed a caller the column, constraint and value
    out of the PostgREST body — CWE-209.
  - The one exception is a service's own refusal: an error built with
    `ruleError(message)` (`~/utils/supabase`, code `CARBON_RULE`) is written for
    the caller, so `isServiceRuleError` lets `callOperation` return its message
    as an `execution` error. Return one for a broken business rule a caller can
    fix ("Grade X is not a grade of substance Y"); never wrap a database error
    in it.
  - The **full detail is logged** instead (`logger.error("Operation failed", …)` in
    `call.server.ts`) with the operation name, the classification, the raw Supabase
    error.
  - **HTTP is a separate path and is unchanged**: a 400 body is serialized from the
    `ORPCError` by the oRPC handler, never from `CallResult`, so HTTP callers still
    receive the Postgres `code`/`details`/`hint`. Narrowing that is a separate
    decision about the public API.

  - A **server function's** failure (`ServerFnError`, from a service that calls
    `@carbon/server-functions`) never reaches that classifier: `dispatch.server.ts`
    throws it as an `ORPCError` carrying the function's own message, so
    `CallResult` returns it as an `execution` error. The HTTP code comes from its
    status — 400/403/404/409 map to BAD_REQUEST/FORBIDDEN/NOT_FOUND/CONFLICT; a
    status ≥ 500 with a non-empty message (a refusal thrown at the default status)
    is BAD_REQUEST; an empty message (a data-layer failure) stays
    INTERNAL_SERVER_ERROR with a generic message.
- The dispatch behavior is pinned by
  `api+/v1+/lib/dispatch-parity.test.ts` (golden cases carried over from the
  deleted `executeFunction`) — a change there is a behavior change for MCP,
  the agent, workflows and HTTP at once.

## Tool metadata & the generator (`scripts/generate-mcp.ts`)

`tool-metadata.json` is **generated**, never hand-edited. Run
`pnpm run generate:mcp`; it parses every `apps/erp/app/modules/*/*.service.ts`
(falling back to the `.ee`-licensed `<module>.ee.service.ts` — e.g. `accounting`),
plus an optional server-only companion `<module>.mcp.server.ts` when present (for MCP
functions that must import `*.server` modules — see the gotcha below — e.g.
`production.mcp.server.ts`; the registry (`api+/v1+/lib/registry.server.ts`) merges its
exports into the same module namespace), and writes `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`
(`{ generated, totalTools, modules, tools }`). Each tool entry:
`{ name, module, classification, description, paramCount, serviceParams, contextParams, injectAuth, resultShape, schema }`.

- **How the service files are read** (`scripts/lib/service-ast.ts`): ONE ts-morph
  project, shared with the response-schema reflection. Which functions exist
  (exported declarations AND exported arrow consts), their parameters, their doc
  tags and what their bodies do all come from the AST. The only thing still read
  as text is a parameter's declared TYPE, which `typeToJsonSchema` turns into a
  JSON Schema. A `mcp.server.ts` export that shadows a service function replaces
  it entirely — params, doc and body.
- **A function is a tool because its doc comment says so** (`lib/mcp-exposure.ts`
  is the whole vocabulary). Nothing about a tool is read off the function's name
  except the published name itself (`{module}_{functionName}`):

  ```ts
  /**
   * Creates or updates a customer.
   * @mcp upsert
   */
  export async function upsertCustomer(…)
  ```

  There is one tag, `@mcp`, always lowercase; each line says one thing:

  | Line | Meaning |
  |---|---|
  | `@mcp <verb> [destructive]` | Required, exactly once. No such line → not a tool, reads included. Text after it is a note. |
  | `@mcp permission <module>:<action>[+<action>]` | Only when the gate is not the tool's own module + its verb's action (`getApiKeys` → `users:update`). REQUIRED when the ERP route doing the same thing requires a different module: a supplier bank account is `accounting`, not `purchasing`; a return-order credit is `invoicing`. Pinned in `apps/erp/test/mcp-tool-permissions.test.ts` (`OVERRIDES`). |
  | `@mcp audit <field>[, <field>]` | Only when the verb's audit fields are wrong for intent the schema cannot express (a ledger insert takes `createdBy` alone). Stated in full; `companyId` is always added. |
  | `@mcp key <table> <column>[=<field>], …` | The row an upsert updates when it exists (below). Several lines are alternatives. |

  The verb decides classification, permission actions and audit fields
  (`MCP_VERBS`), pinned by `apps/erp/test/mcp-tool-permissions.test.ts`:

  | Verb | Classification | Permission | Stamped besides `companyId` |
  |---|---|---|---|
  | `read` | READ | view | — |
  | `create` | WRITE | create | createdBy, updatedBy |
  | `update` | WRITE | update | updatedBy |
  | `upsert` | WRITE | create + update | createdBy, updatedBy |
  | `delete` | DESTRUCTIVE | delete | — |
  | `action` | WRITE | update | — |

  `action` is a state change that is not a row edit (lock a period, complete an
  operation). `destructive` after a write verb relabels it DESTRUCTIVE for the
  client — a delete-then-reinsert `upsert` drops whatever the caller left out —
  without changing its permission or audit fields. Classification drives the MCP
  annotations (`READ_ONLY_/WRITE_/DESTRUCTIVE_ANNOTATIONS` in
  `packages/ee/src/mcp/types.ts`).
- **The declaration is checked against the body** (`declarationOf`), in the one
  direction that can be: `read` on a body that writes, or a write verb whose
  body deletes rows without `destructive`, fails generation; so do an unknown
  verb, a setting given twice, and a rest parameter. A write is a supabase
  `.insert/.upsert/.update/.delete` whose receiver chain is rooted in `.from(…)`
  — through `(… as any)`, parentheses, `await` and one local variable;
  `client.storage.from(…)` does not count — or Kysely
  `insertInto/updateTable/deleteFrom`. `members.delete(id)` on a Set is not a
  write. The reverse cannot be checked: a body with no write of its own may hand
  the work to a helper, an RPC or an edge function, which is why the verb is
  declared rather than inferred. `MCP_MODULE_ALLOWLIST` is the coarse gate (a
  module absent from it exposes nothing), and the generator prints how many
  exported functions carry no tag.
- **Why it is declared.** Every exported function used to be a tool and its name
  decided the rest: `get*` was a READ whatever it did
  (`accounting_getOrCreateAccountingPeriod` inserted a period and was published on
  `accounting:view`), `upsert*` meant "stamp createdBy and updatedBy" whatever the
  table had, and a pure function named `diffMethod` demanded `parts:update`.
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
- **The read-tool sweep** (`pnpm sweep:tools`, `apps/erp/test/sweep/`) is the
  only place a tool is run for real: this branch's dispatcher and services, a
  signed-in user's client, a seeded company on a running local stack. Arguments
  are not guessed: `paramFilters` (`service-ast.ts`) reads which column each
  parameter is compared to (`.eq("id", jobId)` on `job`), and a value that
  exists is sampled as the user; a name the tool's own body does not tie to a
  column falls back to what that name is compared to across every service, then
  to the database's own tables and columns of that name. When the company has
  no row to take a value from, the tool is still called, with a value of the
  column's type that matches nothing (the report lists these under
  `placeholder`). The few arguments nothing can answer (`targetCurrency`,
  `timeZone`) are written down per tool in `read-tools.inputs.ts`. It records
  `ok` / `failed` / `not-found` / `not-called`, refuses a stack that has not
  applied this branch's migrations, and gates on `read-tools.baseline.json`,
  which is empty and stays that way unless a failure is knowingly accepted.
  Seed a demo dataset and run the planner first (`pnpm db:seed:dev`): on the
  satellite dataset all 810 read tools are called. It has found three bugs no
  unit test had:
  - An omitted optional list or object argument was handed the whole request
    body (`getActiveJobOperationsByLocation({ locationId })` sent it as
    `workCenterIds`). `omittedNamedParam` now leaves such an argument
    `undefined` when the service takes more than one payload param
    (`dispatch-parity.test.ts` a5).
  - A read did not get the defaults its schema publishes. A service typed from
    a validator's output requires those fields, so `getPurchaseLinePivot` sent
    `state: {}` crashed on `state.columnAxis.type`. `withSchemaDefaults` fills
    them (a6); see "A published default is a promise" below for when.
  - `companyGroupId` inside a payload object was hidden from the schema and
    never filled, so every pivot report, and creating an account, order, quote
    or invoice, ran with no group (see injectAuth below).

  Not part of `pnpm test`: it needs the stack.
- **A `read` tool may only call SQL functions that read**
  (`assertReadCallsOnlyReads`). The generator sees every `.rpc("name")`
  (`rpcCalls`, through casts) but not the SQL behind it, so the function's own
  definition answers: `packages/database/src/sql-effects.ts` parses every
  migration in timestamp order, then the managed function files, with Postgres's
  parser (`libpg-query`), keeps each function's CURRENT definition (a later
  `CREATE OR REPLACE` replaces, another signature is an overload, `DROP` removes)
  and walks its body, following calls into other functions. It answers `reads`,
  `writes` (with the statement) or `unknown` (with why): dynamic `EXECUTE`, a
  language it does not read, an extension function absent from
  `EXTERNAL_READS` / `EXTERNAL_WRITES`, or no definition at all. `writes` and
  `unknown` both fail generation for a `read` tool. Dynamic SQL a person has
  read goes in `REVIEWED_DYNAMIC_READS`, pinned to the migration that holds the
  definition, so a later redefinition is `unknown` again. This is how
  `settings_getNextSequence` (its rpc runs `UPDATE sequence`) was a READ gated
  on `settings:view`; it is now `@mcp action`. Migrations are an input of
  `//#generate:mcp` and of the pre-commit manifest check, so a function that
  starts writing re-runs the check. Pinned by `sql-effects.test.ts` and
  `apps/erp/test/mcp-service-ast.test.ts`.
- **contextParams** (`contextParamsOf`) says which positional params the
  dispatcher fills and with what, and is the only place that is decided. Two
  sources: the positional contract `POSITIONAL_CONTEXT`
  (`scripts/lib/validator-registry.ts`: `client`, `eliminationClient`, `db`,
  `userId`, `companyId`, `companyGroupId` — a plain `string` carries nothing more
  for the compiler to read), and the body. `auditParams` (`service-ast.ts`) finds
  every parameter the function writes as the value of a `createdBy` / `updatedBy`
  property, by shorthand or by name, through the compiler's own symbol
  resolution; such a param is the acting user whatever it is called, and maps to
  `userId`. A positional param NAMED `createdBy`/`updatedBy` that the body is not
  seen writing to the column fails generation — published it would let a caller
  name the author, hidden without a slot nobody would fill it. Context params are
  left out of the published schema. The digest shows a mapping only where the
  source differs from the name (`"context":"updatedBy=userId"`). Pinned by
  `apps/erp/test/mcp-service-ast.test.ts`.
- **A field whose type admits `undefined` is optional**, with or without `?`
  (inline object types). `assignee: null | undefined` used to publish as a
  required `null` on eight status tools, so every status change had to send
  `assignee: null` and cleared it. `mcp-tool-metadata.test.ts` also refuses any
  required property that can only be null, across the whole manifest.
- **injectAuth** starts from the verb's audit fields (table above) plus
  `companyId`, then is checked against the schema (`withoutAbsentAuditColumns`):
  when the function names exactly ONE relation and that relation has no
  `createdBy`/`updatedBy` column, the field is dropped — dispatch stamps these
  onto the payload object, and a service that spreads its argument into the write
  would otherwise send a column that does not exist (PGRST204, how
  `items_upsertItemCustomerPart` failed). Zero or several relations leaves the
  set alone. `userId` is added when the payload's own type declares one
  (`withPayloadUserId`), and `companyGroupId` when any payload parameter's TYPE
  has that property (`withPayloadCompanyGroup`, asked of the type checker, so a
  named or inferred type counts). The dispatcher cannot tell the shapes of a
  union apart and stamps all of them, so the generator refuses a union where
  only some shapes declare it: declare it on each (optional where unused) and
  destructure it out before the row is written, as `upsertPurchaseOrder` does.
  `@mcp audit` replaces all of that for intent the schema cannot express.

- **A write is confined to the caller's company, whatever the service filters
  on.** The `client` a service is handed is `scopedToCompany(context.client, …)`
  (`api+/v1+/lib/company-scope.server.ts`): every `.update()` and `.delete()` on
  a table with a `companyId` column also gets `.eq("companyId", <caller's>)`.
  Services match the row they write by its id, and a signed-in user's client
  reaches every company they belong to, so an id from the user's other company
  used to match — and because the dispatcher stamps the active `companyId` into
  the payload, an update that spread it moved the row. With the filter a write
  can only match a row already in the caller's company. The table list is
  `companyTables` in `tool-metadata.json`, read from the generated database
  types (`getDbTablesWithColumn`); generation fails if it comes back short.
  Reads, inserts, RPCs and storage pass through; a Kysely `db` is not wrapped
  (it is covered by the `no-unscoped-kysely-write` check). Pinned against real
  request URLs in `company-scope.test.ts` and end to end in
  `dispatch-parity.test.ts`.

- **An argument is never published blank unless it is.** The input schema is
  built from the signature's text and the validators. What neither resolves — a
  named row type, a `ReturnType<…>`, an enum from another module — used to come
  out as `{}`: an argument with no shape (`getDocumentTemplate`'s
  `documentType`, one of eleven strings; 21 tools in all).
  `describeUntypedArguments` now fills every blank node from the parameter's
  own TYPE, with the reflection the response schemas use (`typeToJsonSchema` in
  `response-schema.ts`, which reads a tuple or readonly array as a list). Only
  `any`, `unknown` and `Json` stay blank — `Json` recognised by its members,
  since `customFields?: Json` reaches the checker with the alias gone. The API
  validates input against the schema, so a service that takes a whole row but
  reads three fields now DEMANDS the whole row: type the parameter as what it
  reads (`Pick<Job, "id" | "salesOrderLineId" | "quoteLineId">`).

- **A published default is a promise, kept or not made.** `default` in JSON
  Schema enforces nothing; a caller reading `taxPercent: default 0` leaves the
  field out and expects 0. The defaults come from the form validators
  (`.default(0)`), written for a form that submits every field, so the same
  default sits on create and update alike — and over the API an update is
  partial. The manifest entry's `defaults` (`defaultsPolicy`, in the digest)
  says when the dispatcher fills them:
  - `always` — `read`, `create`, `action`: the call supplies a whole value.
  - `create` — an `upsert` with a rule, only when it resolves to a create. On
    update a field left out keeps what is stored; the property's description
    says so.
  - absent — `update`, `delete`, and an upsert with no rule (nothing says
    whether the call updates). `publishDefaults` REMOVES every default from
    such a schema, and from any place the dispatcher's walk does not reach
    (several object alternatives of a union, a record's values), so no schema
    publishes one that is not applied.
  A default is published only when leaving the field out really has that
  effect. A list read's `limit` has none: `setGenericQueryFilters` pages only
  when it is handed a limit, so the schema's old `default: 100` described a
  page size no caller ever got, and filling it would have cut every unpaged
  list read to 100 rows (`dispatch-parity.test.ts` a13). `offset` keeps its
  `0`, which is what lets a `limit` sent alone page at all.
  The dispatcher fills each ARGUMENT against its own schema after the body's
  shape is known (`filled` in `dispatchOperation`), never the raw body: adding
  keys beside a `{ args: {…} }` wrapper would change which shape it is read as.
  `withSchemaDefaults` and `publishDefaults` are the same walk (`properties`,
  `items`, a union's one object or array alternative), pinned against one
  fixture in `dispatch-parity.test.ts`; `mcp-tool-metadata.test.ts` fails a
  tool that publishes a default with no policy. When this landed every default
  filled on a create equalled the column's own database default, except
  `salesInvoiceLine.unitOfMeasureCode` ("EA", as the form sends).

- **Create vs update on an upsert is never the caller's question.** A service
  that picks insert-vs-update by testing for an audit field on the payload
  (`branchesOnKeyPresence`: `"createdBy" in …` create-branch first, e.g.
  `upsertQuoteOperation`, or `"updatedBy" in …` update-branch first, e.g.
  `upsertQuoteMaterial`, `upsertJobMaterial`, `upsertJob`) needs exactly ONE of
  the two stamped — stamp both and an `"updatedBy" in` service takes its UPDATE
  branch on every create, matches zero rows and returns PGRST116. The generator
  records how to decide in the manifest entry's `upsert` (also in the digest), and
  fails generation for a branching upsert it cannot give a rule to. An `upsert`
  that branches some other way (`"id" in line`, twenty of them: invoice, order
  and quote lines) gets the by-`id` rule too whenever its type makes `id`
  decisive. Without one both audit fields were stamped on every call, and since
  those services spread the payload into their UPDATE, editing a row through
  the API rewrote its `createdBy` (`dispatch-parity.test.ts` a8):
  - **By `id`** (`{ keys: ["id"] }`, most upserts) — read off the parameter's TYPE
    (`idDistinguishesUpdate`, `service-ast.ts`): every union member that requires
    `updatedBy` has an `id`, and no other member requires one. Sending `id` means
    update; omitting it means create.
  - **By lookup** (`lookups: [{ table, match }]`, the rest) — declared on the
    function with `@mcp key <table> <column>[=<field>], …` when the payload
    cannot say: a part's `id` is its part number on create and its item id (or
    part number) on update, so `upsertPart` carries `@mcp key item id` and
    `@mcp key item readableId=id` (alternatives); a pick method has no id, only
    `itemId, locationId`. The dispatcher looks the row up with the caller's
    client, scoped to the caller's company (the table must have `companyId`), and
    updates when it exists.
  `resolveUpsertOperation` (`api+/v1+/lib/dispatch.server.ts`) applies the rule —
  a missing or empty key is a create without asking the database. The key is
  read from the RECORD only: the body's top level, the payload parameter's
  wrapper (`{ job: { id } }`), or a lone unnamed wrapper. Never from any other
  nested object — `{ name, customFields: { id } }` was once read as an update.
  It then stamps
  `createdBy` and suppresses `updatedBy` on create, the reverse on update. The
  key field's schema `description` says what sending it does. These tools used
  to require `_operation: "create" | "update"`; no schema publishes it now, but
  a caller that still sends it is obeyed (and a value other than those two is
  refused). Pinned by `dispatch-parity.test.ts` (f, f2, f3, o–t) and
  `mcp-tool-metadata.test.ts`.

## The 16 modules (current `tool-metadata.json`)

`account` · `accounting` · `documents` · `inventory` · `invoicing` · `items` ·
`people` · `production` · `projects` · `purchasing` · `quality` · `resources` · `sales` ·
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
| `search_tools` | Ranked discovery. Filters: `query`, `module` (substring), `classification`, `limit` (default 10) / `offset`. |
| `describe_tool` | The contract for one `name` or up to 10 `names`: description, permission, list marker, input and response schema. |
| `call_tool` | Run a READ or WRITE tool: `{ name, arguments, fields? }`. `arguments` may arrive as a JSON string. Parameters go flat, exactly as `describe_tool` lists them. |
| `call_destructive_tool` | The same, for a DESTRUCTIVE tool, with `destructiveHint: true`. Each refuses the other's tools, so a client can ask before a delete runs; one handler (`runCall`) serves both. |

An unknown name in `call_tool` or `describe_tool` is answered with the three
closest tools from catalog search ("Did you mean: …"); `call_tool` does not
dispatch it.

`call_tool` also refuses, without dispatching, a top-level argument a STRICT
input would drop (`unknownArguments`, `describe-format.ts`): one whose schema
lists `properties` and publishes no `additionalProperties` (a `z.object`; a
`z.looseObject` publishes `additionalProperties` and is left alone). The HTTP
API keeps accepting and dropping such a field; an agent reads that success as
"saved". The call is logged with its argument KEYS only (values are customer
data). It was found when the refactor's strict inputs silently dropped the
`workInstruction` and `assignee` that the old pass-through tools wrote
(`.ai/runs/2026-10-19-api-refactor-lost-mcp-writes.md`).

### Catalog search (`packages/ee/src/mcp/catalog-search.ts`)

BM25 full-text search via **zbsearch**, index built lazily once per process over
the manifest.

- Fields and boosts: `name` (4), camelCase-split `tokens` (3), `description`
  (1.5), input property names `fields` (0.5). Prefix expansion is on; a query
  with no match retries with `tolerance: 1`.
- `SEARCH_ALIASES` expands domain abbreviations additively (`rma`, `po`,
  `bom`, `nonconformance` → issue, `shelf` → storage unit, …), and
  `PHRASE_ALIASES` multi-word terms (`work orders` → jobs, `non conformance` →
  issue). `expandQueryTerm` adds each word's inflection stem to
  the QUERY, never the index. The in-app agent's `search_docs`
  (`doc-search.ts`) shares it.
- BM25 finds the matches; `createNameComparator` orders them, applied as
  zbsearch's `sortBy` to every hit before `limit`/`offset`, so paging and the
  total stay native. Order: the exact tool name (with or without its module),
  then query words the NAME covers, then words matched in full (an
  `ACTION_SYNONYMS` word such as create → insert, or every word of an alias),
  then READ first when the query names no action, then fewer extra name words,
  then a database-paged tool before a `get*List` that reads the whole table,
  then the BM25 score. BM25 alone ranked `inventory_getInventoryItems` tenth for
  its own name, and no `relevance` (k, b) or `threshold` setting gets close:
  measured 22/34 at best against 33/34. Pinning cannot hold the exact-name rule
  because it matches the expanded term, not the query. `stemInflection` leaves
  "materials" unstemmed, so `sameWord` also accepts a plain -s/-es plural.
- `DOCUMENT_VERBS` (receive → receipt, ship → shipment) ranks tools named for
  that document first, before name coverage: "receive a purchase order" asks
  for a receipt, and the order's two words otherwise outranked it.
- `module` keeps substring semantics; filter-only calls bypass the index.
- `search_tools` output (`formatSearchResults`, `describe-format.ts`): one
  line per tool in rank order, `name [READ] (requiredParams, +N optional)`
  (`formatParamSummary`), plus ` — ` and the description's first paragraph when
  it says more than the name (`searchLineDescription`; case, a closing full
  stop and articles do not count, and 937 of 1,612 summaries only restate the
  name). Results are not grouped by module: grouping put lower-ranked tools
  above better ones, and the name already carries the module. A page short of
  the total names the next offset.
- `describe_tool` (`formatToolDescription`) opens with `name [CLASS]`, the
  description, and `Permission:` (the gate checks it for every caller, not only
  API keys).
- `describe_tool` prints input and response schemas as TypeScript types
  (`formatSchemaType`): the manifest's schemas use only type, enum, anyOf,
  properties, required, items and additionalProperties, so nothing is lost and
  the text is under half the JSON Schema's size.
- Server instructions: `packages/ee/src/mcp/instructions.ts`. `lib/manifest.ts`
  keeps its own copies of the meta-tool descriptions; keep them in sync by hand.
- Pinned by `lib/catalog-search.test.ts` and `lib/describe-format.test.ts`.

### Responses are token-lean (`packages/ee/src/mcp/format-result.ts`)

MCP text differs from the HTTP body on purpose; the other `callOperation`
callers get the exact data.

- A list of records is CSV under a `# <tool>.csv` title, written by `encodeCsv`
  (`@carbon/files/csv`, the one CSV encoder) with `formulaSafe: false`: the
  reader is an agent, and stripping `=`/`+`/`-`/`@` would change values such
  as `+1 555 0100`. The column names come once, then one line per record. An
  empty cell is null or empty, a nested value (arrays included) is JSON in its
  cell, and a column empty in every row shown is left out. A single record, or
  a list of plain values, stays compact JSON with nulls removed.
- Why CSV, measured on 100 real inventory rows (o200k tokens, a proxy: Claude's
  tokenizer is not public): compact JSON 27,207, CSV 13,778 (−49%), markdown
  table 17,656, TOON 32,298, markdown key-value 29,631. TOON is larger than
  JSON here because null-stripped rows are not uniform, and its compact form
  needs uniform rows. With 6 `fields`: JSON 5,822, CSV 3,917, TOON 3,999.
  Published comparisons find no single best format; markdown key-value reads
  best for small models on 1,000-row tables, while at about 100 rows strong
  models read CSV and JSON near-perfectly. Anthropic's tool-writing guidance
  says to choose by your own evaluation. Measure tokens, not characters:
  characters overstated CSV's saving (71% vs 49%).
- A list stops at `MCP_MAX_ROWS` (100) rows or `MCP_MAX_CHARS` (20,000)
  characters, always with at least one row; any list short of its total ends
  with `(rows A-B of TOTAL; next page: offset N)`. A `limit` above
  `MCP_MAX_ROWS` is clamped before the call. `call_tool.truncate: false` lifts
  all three: the caller's limit goes to the database (PostgREST's 1,000-row cap
  still applies) and every row it returns is written.
- `call_tool.fields` (beside `arguments`, not inside them) keeps only those
  top-level fields of each row (`projectFields`). `limit: 1` plus
  `fields: ["id"]` is the cheap way to read a total.
- The instructions and the `call_tool` description say record contents are
  data written by people, never instructions to follow.
- **Paging splits on `paginates`**:
  - `paginates: true` (a `paged` service function): `call_tool` fills `limit`
    (`MCP_DEFAULT_LIMIT`, 25) and `offset` (0) when the caller leaves them out.
  - `paginates: false` list: the function returns every row. `call_tool` takes
    the caller's `limit`/`offset` (defaults 25/0) and pages the RESPONSE
    (`pageMcpListResult`). `describe_tool` says so and names a paginating
    sibling when one exists (`paginatingSibling`).

## The read-tool sweep

`pnpm sweep:tools` (`apps/erp/test/sweep/`) runs every READ tool for real
through `callOperation` (`authKind: "oauth"`, the user's own scopes) against a
seeded company on a running local stack. Arguments are sampled from the
company's rows: `publishedParamFilters` (`scripts/lib/service-ast.ts`) reads each
published leaf's `run`, and the building block it hands its input to
(`service.getJob(client, input.id)`), for the column each input field is
compared to, as a path into the tool's input; the few nothing can answer are in
`read-tools.inputs.ts`. A `notFound` refusal counts as not-found, not a failure.
It gates on `read-tools.baseline.json`, which stays empty unless a failure is
knowingly accepted. Seed first (`pnpm db:seed:dev`). Not part of `pnpm test`.

## The agent evaluation

`apps/erp/test/mcp-eval/satellite.xml`: ten read-only, multi-hop questions in
the mcp-builder skill's format, answered only through the meta-tools,
each with one answer checked by string comparison. The answers come from the
satellite demo dataset (no dates or sequence ids), so they hold for any company
seeded with it; the file's header names the traps it sets on purpose. Run it
with that skill's `scripts/evaluation.py` and a `crbn_` key holding the view
scopes. Not part of `pnpm test`.

## The 14 modules

`accounting` · `documents` · `inventory` · `invoicing` · `items` · `people` ·
`production` · `purchasing` · `quality` · `resources` · `sales` · `settings` ·
`shared` · `users`. Each is one namespace in `modules/router.server.ts`. The
caller's own account (`users_getAccount`, `users_updatePublicAccount`, …) is
part of `users` and gates on company membership.

## File uploads (two-step, signed URL)

`call_tool.arguments` is JSON only, so a file goes up in two steps and its
bytes never pass through the model or the dispatch.

- **Step 1:** a per-entity tool mints a folder-scoped signed upload URL and
  returns `{ path, token, signedUrl }`: `production_createJobDocumentUploadUrl`,
  `items_createItemDocumentUploadUrl`, `sales_createOpportunityDocumentUploadUrl`,
  `sales_createOpportunityLineDocumentUploadUrl`,
  `purchasing_createSupplierInteractionDocumentUploadUrl`,
  `purchasing_createSupplierInteractionLineDocumentUploadUrl`, and the generic
  `documents_createDocumentUploadUrl` (raw `folder` / `entityId`). Per entity
  because an opportunity's storage folder id differs from its source document
  id. Path convention: `buildDocumentUploadPath` (`documents.models.ts`).
- The agent PUTs the bytes to `signedUrl`.
- **Step 2:** `documents_insertUploadedDocument` registers the `document` row
  (`size` in KB; read/write groups default to the creating user).
- Works on the OAuth path. An API key is not a Supabase JWT (`auth.uid()` is
  null), so the company bucket's storage RLS refuses the mint.

**CAD models** follow the same two steps with their own pair:
`items_createModelUploadUrl` (`{ name }` → `{ signedUrl, token, path, modelId }`,
signed into the `temp-staging` bucket, 2.5 GB) and `items_insertModelUpload`
(`{ modelId, path, name, size, itemId?, jobId?, salesRfqLineId?, quoteLineId?,
salesOrderLineId?, convert? }`). The `temp-staging` storage policies read the key's
scopes (`parts_create` / `parts_update`), so an API key with those scopes can mint
the URL and upload — unlike the document pair above, which signs into a company bucket.

## Rich text is Markdown

A rich-text column (notes, work instructions, change-notice text) holds a
TipTap document. A tool takes it as Markdown and stores it with
`TiptapText(text).toDocument()` (`@carbon/files/markdown`, CommonMark, raw HTML
kept as text, no DOM), so headings, bold, italic, lists, links, quotes and code render
in the editor. The entry points: `toTiptapDoc` / `optionalTiptapDoc`
(`shared.models.ts`; a JSON document string or object passes through), the
three `set…WorkInstruction` tools, and `shared_setNotes`, which writes the
notes a person edits in the app (`noteFields`: internal / external notes on
sales and purchasing documents and lines, `notes` on jobs, items, fixed
assets, picking lists and stock transfers) as the caller, like the editors.
Empty text stores `{}`. `TiptapText(text, { format: "text" })` stores text as
typed, for imported text that is not ours to read as Markdown (Paperless Parts)
and for contract notes (`optionalPlainTextDoc`): the app edits them in a plain
textarea read back with `TiptapText(doc).toString()`, which would drop the
Markdown markers.

## Gotchas

- **Renaming or moving a service function renames its tool**, and there are no
  aliases. List the old and new names in the changelog entry. Workflow
  definitions name tools too: `check-workflow-catalog.ts` catches the catalog,
  not a customer's saved workflow.
- Publish a function only when it is safe with nothing but its input. The API
  runs the gate and `run`; nothing a route does around the call.
- A function gated on several modules publishes `module: null` in the
  manifest; its own gate decides, as for every function.
- **A form validator's `.refine()` checks are invisible in the published
  schema**: the manifest says a field is optional, and the call refuses it
  anyway. Give the API input the base object and fill or keep what a caller
  leaves out. The job and quote operations do: `baseJobOperationValidator` /
  `baseQuoteOperationValidator`, a create filled by `withOperationStandards`
  (`shared.service.ts`, as the bill of process form fills it), an update
  leaving out what it was not sent; only the inspection plan stays required
  (`inspectionPlanRequired`). Pinned by `apps/erp/test/operation-api-input.test.ts`.
- "Shelf" was renamed to **storage unit** (`inventory_*StorageUnit*`). "Shelf
  life" (`*ShelfLife*`) is a different, current concept.
