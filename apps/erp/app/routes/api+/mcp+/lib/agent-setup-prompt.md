# Connect Carbon's MCP server

These are the official instructions from Carbon for connecting an AI agent to
this Carbon ERP instance over the Model Context Protocol (MCP). Carbon is an
API-first operating system for manufacturing — ERP, MRP, MES and QMS. Its MCP
server exposes every ERP operation (items, sales, purchasing, production,
inventory, quality and accounting) as tools an agent can search, inspect and
call.

**You are the agent.** Do the setup yourself — pick the section that matches the
tool you are running in, write the config or run the command, and then verify
the connection. Do not hand these steps back to the user to run manually unless a
step explicitly requires them (creating an API key, or approving an OAuth
consent screen in their browser). When you have to wait on the user for one of
those, say exactly what you need and continue as soon as it is done.

---

## The one thing you need to know

This instance's MCP server is a single remote endpoint:

```
{{MCP_URL}}
```

That URL is this deployment's own endpoint — for Carbon Cloud, a self-hosted
install, or a controlled (ITAR) environment alike — so use it exactly as printed
above; don't substitute a different host. Transport is **streamable HTTP**
(JSON-RPC), and it is stateless — there is no session to keep alive. You can
confirm the endpoint and the server's capabilities without authenticating by
fetching its manifest at `{{ORIGIN}}/.well-known/mcp.json`.

The server does **not** register hundreds of individual tools. It registers
three meta-tools, and every ERP operation is reached through them:

| Tool | What it does |
| --- | --- |
| `search_tools` | Find operations by name, module, or classification (`READ` / `WRITE` / `DESTRUCTIVE`) and make the matches callable. |
| `describe_tool` | Return the full input schema and description for one operation, so you can build its arguments correctly. |
| `call_tool` | Execute an operation by name with its arguments. |

So the working loop is always **search → describe → call**. Do not expect a flat
tool list; discover what you need with `search_tools` first.

---

## Choose an authentication mode

There are two ways in. Pick based on your client.

### OAuth (no key — connector clients)

Claude.ai, Claude Desktop, and ChatGPT add the server by URL and authorize in the
user's browser. The user picks which of their companies to grant, and the
connection then acts as that user with exactly their Carbon permissions. Nothing
to paste, no key to manage. Prefer this whenever your client supports remote MCP
connectors.

### API key (command & config clients)

Claude Code, Cursor, VS Code, Codex, and any headless / CI use authenticate with
a bearer API key. The user creates it in **Carbon → Settings → API Keys**; it is
scoped to one company and to explicit module permissions (View / Create / Update
/ Delete), rate-limited, and shown only once. Ask the user to create a key and
paste it, then use it as `Bearer <api-key>` in the `Authorization` header.

> **Scope tightly.** For a read-only agent, ask for a key with View permissions
> and no Create/Update/Delete. Use a **separate key per client** so one can be
> revoked or re-scoped without touching the rest.

Whichever mode, the identity can never do anything the granting user can't —
row-level security in the database enforces the same boundary as the app, and
`companyId` / `userId` always come from the credential, never from tool
arguments.

---

## Set it up in your client

### Claude Code

Run this command (fill in the key the user created):

```bash
claude mcp add --transport http carbon \
  {{MCP_URL}} \
  --header "Authorization: Bearer <api-key>"
```

You can also omit the `--header` flag entirely — the server answers an
unauthenticated request with a `401` and a `WWW-Authenticate` header pointing at
its OAuth metadata, so Claude Code will start the browser OAuth flow on first
use. Use the header form when the user has a scoped key, the keyless form when
they'd rather authorize in the browser.

### Cursor

Write `.cursor/mcp.json` in the project root (or merge into the existing
`mcpServers` object):

```json
{
  "mcpServers": {
    "carbon": {
      "url": "{{MCP_URL}}",
      "headers": { "Authorization": "Bearer <api-key>" }
    }
  }
}
```

### VS Code (GitHub Copilot, Agent mode)

Write `.vscode/mcp.json`. VS Code uses `servers` (not `mcpServers`) and can prompt
for the key as an input so it isn't committed in plaintext:

```json
{
  "inputs": [
    { "id": "carbon-key", "type": "promptString", "description": "Carbon API key", "password": true }
  ],
  "servers": {
    "carbon": {
      "type": "http",
      "url": "{{MCP_URL}}",
      "headers": { "Authorization": "Bearer ${input:carbon-key}" }
    }
  }
}
```

### Claude Desktop

Add it as a custom connector, not as a config-file entry: **Settings →
Connectors → Add custom connector**, paste `{{MCP_URL}}`, and authorize in the
browser (OAuth). No key needed.

### ChatGPT

**Settings → Connectors → Add** the MCP server URL `{{MCP_URL}}` and authorize in
the browser (OAuth). Available on the plans that support custom connectors.

### Any other MCP client

Any client that accepts a **streamable-HTTP** MCP server takes the same two
values: the URL `{{MCP_URL}}` and an `Authorization: Bearer <api-key>` header (or
OAuth if the client supports remote connectors). The config key that holds the
URL varies by client — some use `url`, some use `serverUrl` — so check that
client's MCP docs for the exact field name, then plug in the values above.

---

## Verify the connection

Do not report success until you've actually reached the server. Confirm it by
listing the three meta-tools and running one read:

1. The client should now expose `search_tools`, `describe_tool`, and
   `call_tool`. If it doesn't, the server isn't connected — recheck the URL and
   header.
2. Call `search_tools` with a query like `"customers"` to confirm auth works and
   you get operations back.
3. Optionally `describe_tool` one of them and `call_tool` a `READ` operation to
   confirm data flows.

If a request comes back `401`, the key is missing, malformed, expired, or
deleted (recreate it in Settings → API Keys) — or a connector needs
re-authorizing. A `403` means the identity is authenticated but lacks the module
permission for that action, or, on Cloud, the company is on the Starter plan
(API and MCP access is a Business-plan feature). A `429` means you've exceeded
the key's rate limit — the `X-RateLimit-*` headers say when to retry.

---

## What you can do once connected

You act as the authorizing user, across every module they can reach. In natural
terms:

- "Show all open sales orders due to ship this week."
- "Which purchase orders are past their promised receipt date?"
- "What's the on-hand quantity and reorder point for a part across locations?"
- "Draft a quote for a customer for 200 aluminum housings."
- "List every job behind schedule and who's assigned."

Reads are safe. Before a `WRITE` or `DESTRUCTIVE` operation, confirm the intent
with the user — the classification is right there in `search_tools` and
`describe_tool` output, so you always know which kind you're about to run.

---

## ✅ Done

When the three meta-tools are present and `search_tools` returns operations, the
Carbon MCP server is connected. Tell the user it's ready, which mode you used
(OAuth or API key), and — if a key — remind them it's scoped and revocable in
Settings → API Keys.

## Resources

- MCP guide — https://docs.carbon.ms/mcp
- Authentication — https://docs.carbon.ms/mcp/authentication
- Tools reference — https://docs.carbon.ms/mcp/tools
- API keys — https://docs.carbon.ms/docs/reference/api-keys
- Server manifest — {{ORIGIN}}/.well-known/mcp.json
