---
paths:
  - "apps/erp/app/routes/api+/mcp+/**"
  - "scripts/generate-mcp.ts"
---

# Carbon ERP MCP Server

The ERP exposes an MCP (Model Context Protocol) server that wraps the module
service functions as ERP tools. It lives entirely under
`apps/erp/app/routes/api+/mcp+/`.

> Don't recreate the old per-tool dump — it goes stale instantly (it still listed
> `inventory_getShelf`, removed when `shelf` was renamed to `storageUnit`). The
> live tool list is `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`;
> `describe_tool` / `search_tools` read from it at runtime.

## Endpoint & transport

- Route: `POST /api/mcp` (`api+/mcp+/_index.ts`). `loader` rejects non-POST (405);
  `OPTIONS` → 204 with CORS. JSON-RPC over
  `WebStandardStreamableHTTPServerTransport` (`enableJsonResponse: true`,
  `sessionIdGenerator: undefined` — stateless, no session).
- A fresh `McpServer` (`createMcpServer(ctx)`) is built per request and connected
  to a fresh transport.

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

Auth always yields an `McpContext` = `{ client, companyId, companyGroupId, userId }`
(`lib/types.ts`). `companyId`/`userId` come from the auth context and are injected
server-side — never trusted from tool arguments.

## The 3 meta-tools (the ONLY tools actually registered)

To avoid context exhaustion, `server.registerTool` registers just three discovery
tools (`lib/server.ts`); the ~1200 ERP functions are reached through them, not
registered individually:

| Tool | Purpose |
|------|---------|
| `search_tools` | Discover tool names. Filters: `query`, `module`, `classification` (`READ`/`WRITE`/`DESTRUCTIVE`), `limit`/`offset`. Reads `tool-metadata.json`. |
| `describe_tool` | Return the JSON-Schema + classification + description for one tool name. |
| `call_tool` | Execute any ERP tool: `{ name, arguments }`. `arguments` may arrive as a JSON string and is normalized to an object. |

## How `call_tool` actually runs a tool (`lib/direct-executor.ts`)

`call_tool` does **not** go back through the MCP protocol — it calls
`executeFunction(name, ctx, args)` directly:

- Tool name is `"<module>_<funcName>"`; split on the first `_`. `functionRegistry`
  maps the 15 modules to their `~/modules/<module>/<module>.service` namespace.
- `tool-metadata.json` provides `serviceParams` (positional arg order, e.g.
  `["client", "args"]`) and `injectAuth`. The executor builds the positional
  arg array: `client`/`userId`/`companyId`/`companyGroupId` come from `ctx`;
  payload params are stamped with auth fields via `enrichWithAuthContext`. When a
  payload param is an **array** of rows, `enrichWithAuthContext` stamps
  `createdBy` into each element (insert only) — the top-level stamp never reached
  inside, so a NOT NULL `createdBy` on the row table (e.g. `quoteLinePrice`) used
  to fail. Only `createdBy` is injected per element; `companyId`/`updatedBy` are
  left to the service, since element keys spread straight into an INSERT.
- Blocked tools (`lib/mcp-blocked-tools.ts`, `MCP_BLOCKED_TOOL_NAMES`) are rejected
  in both `call_tool` and the executor. Currently only `settings_seedCompany`.
- Supabase query builders returned by services are awaited; result is
  `{ success, data | error }`. Supabase `{ data, error, count }` shape is unwrapped.

## Tool metadata & the generator (`scripts/generate-mcp.ts`)

`tool-metadata.json` is **generated**, never hand-edited. Run
`npx tsx scripts/generate-mcp.ts`; it parses every `apps/erp/app/modules/*/*.service.ts`
(falling back to the `.ee`-licensed `<module>.ee.service.ts` — e.g. `accounting`),
plus an optional server-only companion `<module>.mcp.server.ts` when present (for MCP
functions that must import `*.server` modules — see the gotcha below — e.g.
`production.mcp.server.ts`; `direct-executor.ts` merges its exports into the same module
namespace), and writes `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`
(`{ generated, totalTools, modules, tools }`). Each tool entry:
`{ name, module, classification, description, paramCount, serviceParams, injectAuth, schema }`.

- **Classification** (`classifyFunction`): `delete*` → `DESTRUCTIVE`;
  `get|list|fetch|search|find|count|check|is|has*` → `READ`; a WRITE whose
  **body issues a delete** (`.delete(` / `.deleteFrom(`, detected by
  `functionBodyDeletes`) → `DESTRUCTIVE` too — a delete-and-reinsert `upsert*`
  (e.g. `upsertQuoteLinePrices`, `replace*Steps`, favourite toggles) is
  destructive-by-omission and the client must treat it as such; everything else →
  `WRITE`. Drives the MCP annotations (`READ_ONLY_/WRITE_/DESTRUCTIVE_ANNOTATIONS`
  in `lib/types.ts`).
- **injectAuth** (`computeInjectAuth`): keyed off the **name verb, not the
  classification** — only `READ` takes `["companyId"]`. `upsert|create|insert|
  add|new|copy|duplicate|generate*` → `["companyId","createdBy","updatedBy"]`;
  `update|set|sync|run|…*` → `["companyId","updatedBy"]`; anything else (incl. a
  genuine `delete*`) → `["companyId"]`. A DESTRUCTIVE-classified `upsert*` still
  inserts rows, so it keeps its `createdBy` — the label is only a caller hint.

- **`_operation`** (`usesCreatedByDiscriminator`): the ~96 tools whose service picks
  insert-vs-update with `if ("createdBy" in …)` get a **required**
  `_operation: "create" | "update"` in their schema — the schema is the only marker,
  there is no parallel metadata flag. `direct-executor.ts` strips `_operation` from the
  args (top level *and* the `{ args: {...} }` wrapper) before building the payload, then
  suppresses the `createdBy` stamp when it is `"update"` — otherwise every MCP edit would
  take the insert branch. Missing/invalid `_operation` on such a tool is rejected before
  the service is called; `call_tool.arguments` is `z.any()`, so the executor is the gate.

## The 15 modules (current `tool-metadata.json`)

`account` · `accounting` · `documents` · `inventory` · `invoicing` · `items` ·
`people` · `production` · `purchasing` · `quality` · `resources` · `sales` ·
`settings` · `shared` · `users`. Each maps 1:1 to a
`apps/erp/app/modules/<module>/<module>.service.ts` namespace (accounting is the
`.ee`-licensed `accounting.ee.service.ts`; the registry key stays `accounting`).

<!-- UNVERIFIED: exact per-module/total tool counts (~1200) drift on every regen — read tool-metadata.json for the live number, don't trust a hardcoded count. -->

## Gotchas

- The generator reads a service's **parameter list textually**, but resolves more
  shapes than it used to. An **inline** array-of-objects
  (`prices: { quantity: number; ... }[]`) now publishes as a typed
  `{"type":"array","items":{...}}`; a `z.infer<typeof V>` validator param resolves
  `V.merge(z.object({...}))` / `applyX(...)` wrappers / referenced `*Validator`s
  (same models file) into real fields; and an `errorMap: () => (...)` inside a
  validator no longer truncates the fields after it. A parameter typed with a bare
  **named alias** (`prices: QuoteLinePriceInput[]`) still publishes with opaque
  `items` — the alias isn't resolved — so spell the object type out inline. Keep
  `//` comments above the function, not inside the parameter list (a comment there
  is parsed as a property name).
- A service whose first parameter is `db` (a Kysely transaction client) is served
  `getDatabaseClient()` by `direct-executor.ts`, the same way `client` is served
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
  `@carbon/ee/storage-rules.server`, an app `*.server.ts`, …) — even via `await import(...)`.
  The module barrel (`~/modules/{module}`) re-exports the service, and client components
  value-import that barrel for validators/enums, so the service is in the **client** bundle;
  React Router's `react-router:dot-server` plugin then fails the build with *"Server-only
  module referenced by client"*. Put such MCP write functions in a server-only companion
  `{module}.mcp.server.ts` instead (never re-exported by the barrel). The generator parses it
  and `direct-executor.ts` spreads its exports into the module namespace, so the tool names and
  metadata are identical to a service-file function. Precedent: `production.mcp.server.ts`
  holds `issueMaterial` / `completeJob`.
