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
  payload params are stamped with auth fields via `enrichWithAuthContext`.
- Blocked tools (`lib/mcp-blocked-tools.ts`, `MCP_BLOCKED_TOOL_NAMES`) are rejected
  in both `call_tool` and the executor. Currently only `settings_seedCompany`.
- Supabase query builders returned by services are awaited; result is
  `{ success, data | error }`. Supabase `{ data, error, count }` shape is unwrapped.

## Tool metadata & the generator (`scripts/generate-mcp.ts`)

`tool-metadata.json` is **generated**, never hand-edited. Run
`npx tsx scripts/generate-mcp.ts`; it parses every `apps/erp/app/modules/*/*.service.ts`
and writes `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`
(`{ generated, totalTools, modules, tools }`). Each tool entry:
`{ name, module, classification, description, paramCount, serviceParams, injectAuth, schema }`.

- **Classification** (`classifyFunction`): `delete*` → `DESTRUCTIVE`;
  `get|list|fetch|search|find|count|check|is|has*` → `READ`; everything else →
  `WRITE`. Drives the MCP annotations (`READ_ONLY_/WRITE_/DESTRUCTIVE_ANNOTATIONS`
  in `lib/types.ts`).
- **injectAuth** (`computeInjectAuth`): READ/DESTRUCTIVE → `["companyId"]`;
  `upsert|create|insert|add|new|copy|duplicate|generate*` →
  `["companyId","createdBy","updatedBy"]`; `update|set|sync|run|…*` →
  `["companyId","updatedBy"]`.

## The 15 modules (current `tool-metadata.json`)

`account` · `accounting` · `documents` · `inventory` · `invoicing` · `items` ·
`people` · `production` · `purchasing` · `quality` · `resources` · `sales` ·
`settings` · `shared` · `users`. Each maps 1:1 to a
`apps/erp/app/modules/<module>/<module>.service.ts` namespace.

<!-- UNVERIFIED: exact per-module/total tool counts (~1200) drift on every regen — read tool-metadata.json for the live number, don't trust a hardcoded count. -->

## Gotchas

- Don't enumerate individual tools in docs — `search_tools` is the source of truth.
  Names follow `<module>_<verb><Entity>` (e.g. `sales_getCustomers`,
  `inventory_upsertStorageUnit`).
- "Shelf" was renamed to **storage unit**: use `inventory_*StorageUnit*`, not
  `getShelf` (which no longer exists). "Shelf life" (`*ShelfLife*`) is a
  *different*, still-current concept — don't conflate them.
- To block a tool from MCP, add its `<module>_<func>` name to
  `MCP_BLOCKED_TOOL_NAMES` and regenerate metadata.
