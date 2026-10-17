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
  move with the checker's type ids.
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
5. `shapeHttpBody`: a list (`isListOperation`, an array response schema) goes
   out as `{ results, count }`, anything else as the bare value.
   `callOperation` reverses it with `unshapeHttpBody`.

## Endpoint & transport

- Route: `POST /api/mcp` (`api+/mcp+/_index.ts`). `loader` rejects non-POST (405);
  `OPTIONS` → 204 with CORS. JSON-RPC over
  `WebStandardStreamableHTTPServerTransport` (`enableJsonResponse: true`,
  `sessionIdGenerator: undefined`: stateless).
- A fresh server (`await createMcpServer(ctx, today, deps)`) is built per
  request. It is async because it awaits `requireEntitlement("MCP")` first.

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
engine: `createMcpServer` throws `EntitlementError`, which the route turns into
a 402 (`makeMcpDisabledResponse`). One check covers both auth paths, the
Community edition and Cloud Starter. The discovery endpoints are not gated.

## The 3 meta-tools

Only three tools are registered (`packages/ee/src/mcp/server.ts`); every ERP
operation is reached through them.

| Tool | Purpose |
|------|---------|
| `search_tools` | Ranked discovery. Filters: `query`, `module` (substring), `classification`, `limit`/`offset`. |
| `describe_tool` | The contract for one `name` or up to 10 `names`: description, permission, list marker, input and response schema. |
| `call_tool` | Run a tool: `{ name, arguments }`. `arguments` may arrive as a JSON string. Parameters go flat, exactly as `describe_tool` lists them. |

### Catalog search (`packages/ee/src/mcp/catalog-search.ts`)

BM25 full-text search via **zbsearch**, index built lazily once per process over
the manifest.

- Fields and boosts: `name` (4), camelCase-split `tokens` (3), `description`
  (1.5), input property names `fields` (0.5). Prefix expansion is on; a query
  with no match retries with `tolerance: 1`.
- `SEARCH_ALIASES` expands domain abbreviations additively (`rma`, `po`,
  `bom`, `shelf` → storage unit, …). `expandQueryTerm` adds each word's
  inflection stem to the QUERY, never the index. The in-app agent's
  `search_docs` (`doc-search.ts`) shares it.
- `module` keeps substring semantics; filter-only calls bypass the index.
- One line per tool: `name [READ] (requiredParams, +N optional)`
  (`formatParamSummary`, `describe-format.ts`).
- Server instructions: `packages/ee/src/mcp/instructions.ts`. `lib/manifest.ts`
  keeps its own copies of the meta-tool descriptions; keep them in sync by hand.
- Pinned by `lib/catalog-search.test.ts` and `lib/describe-format.test.ts`.

### Responses are token-lean (`packages/ee/src/mcp/format-result.ts`)

MCP text differs from the HTTP body on purpose; the other `callOperation`
callers get the exact data.

- Compact JSON with null fields omitted (the instructions say so). Top-level
  arrays are capped at `MCP_MAX_ROWS` (100) with an "… N more rows omitted"
  marker; a paged read short of its total appends `(showing R of C rows)`.
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

## Gotchas

- **Renaming or moving a service function renames its tool**, and there are no
  aliases. List the old and new names in the changelog entry. Workflow
  definitions name tools too: `check-workflow-catalog.ts` catches the catalog,
  not a customer's saved workflow.
- Publish a function only when it is safe with nothing but its input. The API
  runs the gate and `run`; nothing a route does around the call.
- A function gated on several modules publishes `module: null` in the
  manifest; its own gate decides, as for every function.
- "Shelf" was renamed to **storage unit** (`inventory_*StorageUnit*`). "Shelf
  life" (`*ShelfLife*`) is a different, current concept.
