# API keys

> A scoped secret that lets an external system call the Carbon API on your behalf, with its own permissions and rate limit.

An API key is a secret string that authenticates programmatic calls to Carbon. Where a person signs in and Carbon reads their permissions from a session, a script sends its key on every request and Carbon reads the key's own permissions instead. A key belongs to one company, carries an explicit set of scopes, and has its own rate limit, so you can hand a partner or a job exactly the access it needs and nothing more.

Create and manage keys under **Settings → API Keys**. Every key you see is listed by **Name**, a masked **Key** preview (only the last five characters, e.g. `crbn_•••abcde`), its **Scopes**, **Rate Limit**, who created it, and when it expires.

## Creating a key

Click **New API Key** and give it a **Name** (unique within your company). Optionally set **Expires At** — a future date after which the key stops working; leave it blank and the key never expires. Then grant scopes with the permission matrix (covered below) and save.

Carbon shows the full key exactly once, in a dialog headed "You can only see this key once. Store it safely." Copy it right then. Carbon never stores the raw key: it keeps only a SHA-256 hash for lookup and the five-character preview for display. There is no way to reveal a key again later, so if you lose it, delete the key and create a new one.

Anyone holding the key can act as it, within its scopes. Treat it like a password: store it in a secret manager, never commit it to source control, and rotate it (delete and recreate) if it leaks.

The full format is `crbn_` followed by a random token. The same dialog also hands you a ready-to-paste MCP command that wires the key into an AI assistant — see [The MCP endpoint](#the-mcp-endpoint) below.

## How a key authenticates a request

Send the key in the **`carbon-key`** HTTP header on every request:

```http
GET /rest/v1/salesOrder?select=id,salesOrderId,status
Host: your-carbon-host
carbon-key: crbn_your_key_here
```

Carbon hashes the incoming key, looks up the matching record, and checks two things before it lets the request through:

- **Expiry.** If the key has an `expiresAt` in the past, the request is rejected.
- **Rate limit.** The request is counted against the key's window; if the window is full, the request is rejected.

There is no separate login step and no token to refresh. The header is the whole handshake. The same `carbon-key` header works for the REST API, the edge functions, and (rewritten from a `Bearer` token) the MCP endpoint.

## Permission scoping

A key does **not** inherit the permissions of the person who created it. It acts with exactly the scopes stored on the key, and only for the company it belongs to. A brand-new key with no scopes granted can authenticate but can read and write nothing.

You grant scopes in the permission matrix when you create or edit the key. Each cell is a `module_action` pair — the same shape Carbon uses for a user's permissions. So a key scoped to view sales and create inventory can read `salesOrder` rows and insert inventory records, but a call that needs, say, `purchasing_update` is refused with "API key lacks required permissions" unless you granted that exact scope.

  - **Scopes**: The set of permissions the key carries, e.g. `sales_view`, `inventory_create`. Empty means no access. Edit them anytime from the key's form.
  - **Company**: A key is bound to the single company it was created under. It can never reach another company's data, even one you also belong to.

Because scopes are checked on every request against the key's own record, tightening a key's scopes (or deleting the key) takes effect immediately — there is no cached session to wait out.

## Rate limiting

Each key has its own limit. By default a key allows **1000 requests per hour**; both the count and the window (`1m`, `1h`, or `1d`) are stored on the key. Carbon counts each authenticated request against the current window and rejects anything over the limit with "Rate limit exceeded" until the window rolls over.

The limit is per key, not per company, so you can give a high-traffic integration a larger allowance and keep a throwaway key tight. Build your client to back off when it's throttled rather than hammering through the rejection.

## The REST and OpenAPI surface

The key unlocks Carbon's auto-generated REST API. Every table Carbon exposes is reachable at a PostgREST endpoint (`/rest/v1/<table>`), and the same row-level security that governs the app governs these calls — a request carrying a `carbon-key` is scoped to that key's company and permissions by the database itself, not just the application layer. That means the key can only ever touch data its scopes allow, the same rules the UI enforces.

The full endpoint catalogue, with request and response shapes per resource, lives in the generated [API reference](/api-reference). Point your client at those endpoints, send the `carbon-key` header, and you have programmatic read/write across the modules your key is scoped for.

## The MCP endpoint

Carbon also exposes an MCP endpoint (`/api/mcp`) so an AI assistant can call Carbon's tools with your key. The creation dialog gives you the exact command to register it, passing the key as an `Authorization: Bearer` token that Carbon resolves the same way as the `carbon-key` header. The assistant then operates strictly within the key's scopes — the same permission boundary as any other API call.

## Keys versus webhooks

API keys and `docs/building/webhooks` are two halves of an integration, pulling in opposite directions:

- An **API key** lets *you* call *Carbon* — poll for data, create records, run reports on demand.
- A **webhook** lets *Carbon* call *you* — an HTTP callback the moment a subscribed record changes.

They are independent: a webhook is not authenticated with an API key (Carbon does not sign webhook payloads at all), and an API key does not subscribe to anything. The common pattern is to use both together: let a webhook tell you *that* a record changed, then use your API key to fetch the full, current record from the REST API.

  - Webhooks Get an HTTP callback when a Carbon record changes, then pull the detail with your key.
  - API reference The generated endpoint catalogue for every table and resource.

## Troubleshooting

The exact rejections an API key can return, and the one-time-secret gotcha.

### "API key lacks required permissions"
The call needs a `module_action` scope the key doesn't carry. Scopes are checked per request against the key's own record (`packages/database/supabase/functions/lib/supabase.ts:315`), not the creator's permissions — a key with no scopes can authenticate but read and write nothing. Add the exact `module_action` (e.g. `purchasing_update`) to the key in the permission matrix under **Settings → API Keys**. It takes effect immediately, no session to wait out.

### "Rate limit exceeded"
The key exceeded its allowance for the current window (`supabase.ts:304`). A key defaults to 1000 requests per hour; both the count and the window (`1m`/`1h`/`1d`) are stored on the key. Wait for the window to roll over, or raise the limit on the key. Build your client to back off when throttled rather than retrying immediately.

### "API key has expired"
The key's `expiresAt` is in the past, so it's rejected before any work (`supabase.ts:293`). Create a new key (optionally with a later **Expires At**, or leave it blank to never expire) and swap it in — expiry can't be extended on a used key.

### "API key not found"
The `carbon-key` (or Bearer token) didn't hash to a key for this company (`supabase.ts:287`). Usually a mistyped/truncated key, a key from a different company, or one that was deleted. Carbon stores only a SHA-256 hash and the five-character preview, so verify the full key value.

### I lost the key / can't find where to see it again
There's no way to reveal a key after creation. Carbon shows the full key exactly once, in the "You can only see this key once. Store it safely." dialog, and keeps only a hash afterward. If you lost it, delete the key and create a new one.
