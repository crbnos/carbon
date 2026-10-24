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
