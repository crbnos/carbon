# API keys

> A scoped secret that lets an external system call the Carbon API on your behalf, with its own permissions.

An API key is a secret string that authenticates programmatic calls to Carbon. Where a person signs in and Carbon reads their session's permissions, a script sends its key on every request and Carbon reads the key's own permissions instead. A key belongs to one company and carries an explicit set of scopes, so you can hand a partner or a job exactly the access it needs and nothing more. Manage keys under **Settings → API Keys**.

Claude.ai, Claude Desktop, and ChatGPT connect over **OAuth**: add the server URL, approve in the browser, and the connection inherits the role and company of whoever authorized it. A key is for everything that can't do that browser dance: Claude Code, Cursor, VS Code, Codex, headless scripts, and CI (stdio-only clients bridge through `mcp-remote`). The [authentication reference](/api/authentication) covers both flows.

## Creating a key

Click **New API Key**, give it a **Name** (unique within your company), optionally set **Expires At** (blank means never), grant scopes in the permission matrix, and save. Carbon shows the full key exactly once, in a dialog headed "You can only see this key once. Store it safely." — copy it right then. Only a SHA-256 hash and a five-character preview are kept, so a lost key means delete and recreate. The same dialog hands you a ready-to-paste MCP command that wires the key into an AI assistant.

Anyone holding the key can act as it, within its scopes. Store it in a secret manager, never commit it, and rotate (delete and recreate) if it leaks.

## Authenticating a request

Send the key as a bearer token; the hosted Data API lives at `rest.carbon.ms`:

```http
GET /salesOrder?select=id,salesOrderId,status
Host: rest.carbon.ms
Authorization: Bearer crbn_your_key_here
```

There is no login step and no token to refresh. Carbon hashes the incoming key, looks it up, and checks expiry and the rate limit before letting the request through.

`rest.carbon.ms` takes `Authorization: Bearer crbn_…` and forwards it internally as the `carbon-key` header. Calling PostgREST directly on a self-hosted install, send `carbon-key: crbn_…` against `/rest/v1/<table>` instead. The MCP endpoint takes the same Bearer token either way.

## Scopes and rate limit

A key does **not** inherit its creator's permissions: it acts with exactly the `module_action` scopes stored on it (`sales_view`, `inventory_create`, …), and only within its company. A key with no scopes can authenticate but read and write nothing. Scopes are checked on every request against the key's own record, so tightening them, or deleting the key, takes effect immediately. On Carbon Cloud, API access is a **Business-tier feature**: a company on the Starter plan gets `403` on every call regardless of the key's scopes; see `docs/platform/licensing`.

Every key allows **60 requests per minute**, counted per key, so one integration burning its allowance doesn't throttle another. The limit is platform-controlled: the form has no rate-limit field, and the list's **Rate Limit** column is a report, not an input. A rejected request comes back `429` with `Retry-After` and `X-RateLimit-*` headers; wait it out rather than hammering through.

## What the key unlocks

One key unlocks two surfaces. Reach for the **[Carbon API](/api)** first: the service layer, the same code the app runs when you click a button, with every call validating its input, recalculating what depends on it, and enforcing your permissions. Every operation is reachable two ways with the same arguments, plain HTTP at `POST /api/v1/{module}/{operation}` or a tool over [MCP](/api/mcp), and each carries a `READ` / `WRITE` / `DESTRUCTIVE` classification so a client can filter or gate by risk. Each operation has its own reference page with copyable samples in six languages, and the published OpenAPI spec means a typed client in your language is one generator command away — see [Client SDKs](/api/sdks).

The **[Data API](/api/data)** is direct REST access to every table and view, governed by the same row-level security as the app.

It writes straight to tables, so Carbon does not recalculate the derived values (totals, statuses, ledger entries) it maintains when you write through the Carbon API. Use it when the Carbon API doesn't cover what you need and you know exactly what the table touches.

## Keys versus webhooks

An **API key** lets *you* call *Carbon*; a **`docs/building/webhooks`** lets *Carbon* call *you* when a subscribed record changes. They're independent — webhook payloads aren't signed with a key — and the common pattern is both together: the webhook tells you *that* a record changed, your key fetches the full, current record.

  - Webhooks Get an HTTP callback when a Carbon record changes, then pull the detail with your key.
  - Data API The generated endpoint catalogue for every table and view.

## Internals and troubleshooting

Key format is `crbn_` + random token; storage is SHA-256 hash + last-five preview. `insertApiKey`/`updateApiKey` strip rate-limit columns from any submission (`settings.service.ts:1282`). The 429 response headers come from `packages/auth/src/services/auth.server.ts:255`.

### "API key lacks required permissions"
The call needs a `module_action` scope the key doesn't carry — checked per request against the key's record (`functions/lib/supabase.ts:315`), never the creator's permissions. Add the exact scope in the permission matrix; it applies immediately.

### 403 on every call despite correct scopes
On Carbon Cloud, API access is Business-tier: the key path blocks Starter-plan companies outright (`packages/auth/src/services/auth.server.ts:312-330`). Upgrade the plan; the key itself is fine. A 403 on a single operation is the scope problem above instead. Connectors (OAuth) hit the same plan gate through the identity they inherit.

### "Rate limit exceeded"
Over the key's 60/minute window (`supabase.ts:304`). Platform-controlled, no field to raise it. Honor `Retry-After`; if the ceiling is genuinely too tight, batch reads (PostgREST `in.(...)` filters, embedded relations) or talk to us.

### "API key has expired"
`expiresAt` is in the past (`supabase.ts:293`). Expiry can't be extended on a used key — create a new one and swap it in.

### "API key not found"
The token didn't hash to a key for this company (`supabase.ts:287`): mistyped/truncated, a different company's key, or a deleted one. Verify the full value.

### I lost the key / can't see it again
Not possible by design — the full key is shown once at creation and only a hash is kept. Delete and recreate.
