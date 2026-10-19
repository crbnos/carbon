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
step explicitly requires them (creating an API key, approving an OAuth consent
screen, or installing the marketplace plugin). When you have to wait on the user
for one of those, say exactly what you need and continue as soon as it is done.

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
four meta-tools, and every ERP operation is reached through them:

| Tool | What it does |
| --- | --- |
| `search_tools` | Find operations by name, module, or classification (`READ` / `WRITE` / `DESTRUCTIVE`) and make the matches callable. |
| `describe_tool` | Return the full input schema and description for one operation, so you can build its arguments correctly. |
| `call_tool` | Execute a `READ` or `WRITE` operation by name with its arguments. |
| `call_destructive_tool` | Execute a `DESTRUCTIVE` operation (one that deletes or removes); `call_tool` refuses those. |

So the working loop is always **search → describe → call**. Do not expect a flat
tool list; discover what you need with `search_tools` first.

Which clients can open `{{MCP_URL}}` depends on where they run:

| Client | Where it runs | Fits this origin |
| --- | --- | --- |
| **Grok Build** | Local CLI on a computer that can already open `{{ORIGIN}}` | Yes, including a private network |
| **Cursor** and **Grok Bot** | The **Carbon** plugin in the Cursor Marketplace. One listing, two install buttons | Only when `{{ORIGIN}}` is `https://app.carbon.ms` |
| **Cursor** on any other origin | Local IDE, user file `~/.cursor/mcp.json` | Yes, when this computer can already open `{{ORIGIN}}` |
| **Cursor Cloud Agent** | Cursor's cloud, via that same marketplace plugin | Only when `{{ORIGIN}}` is `https://app.carbon.ms` |

A server added in one of those products is not added in the others. Grok Build
can import a local Cursor `mcp.json`. That import does not register Grok Bot.

---

## Security

Read this before you connect. Five boundaries, all of them in force.

### Network

`{{MCP_URL}}` is this deployment's own origin.

- Loopback (`http://127.0.0.1`) stays on that machine. Use it when the agent and Carbon are on the same computer.
- A request that crosses a LAN or VPN uses HTTPS, so the bearer is not cleartext on that network.
- Grok Bot and a Cursor Cloud Agent run off the computer. They can call this origin only when it is already reachable from the public internet. Do not open a tunnel, and do not add a public listener, to make a private or controlled origin visible to them.
- CORS on `/api/mcp` allows any browser origin. The bearer is the control. Keep it in the local client config. Do not put it in a web page, a chat paste, or a browser extension.

### Credential

Two ways in. They grant different power.

| | API key | OAuth |
| --- | --- | --- |
| Who it acts as | The key's own scopes, for one company. It does not inherit the creator's role | The user who approved the consent screen, in the company they picked |
| Enforcement | Each call checks `module_action` on the key. A key with no scopes can authenticate and can read or write nothing | The user's row-level security and role. The API-key scope list is not consulted |
| Default for a local agent | Yes. One View-only key per client | When the person wants the agent to act exactly as they can in the app |
| Revocation | Delete the key. The next call fails | The token expires. The user disconnects the client |

For Grok Build and local Cursor, ask the user for a key named for that client
(`grok-build-local`, `cursor-local`), with **View** on only the modules this
task may read. Create, Update, and Delete stay off until a write is an accepted
task, and then they go on a separate key. Set an expiry when the work is
temporary.

That secret is a Carbon API key. The same value also calls
`POST /api/v1/{module}/{operation}` and the Data API. An MCP config does not
narrow it to MCP. Scopes are the limit on every surface.

Store it in the user config, owner-read-only (`0600` on Unix). The samples
below use `${CARBON_API_KEY}` or `<api-key>`. Do not write a literal `crbn_`
value into a command (it lands in shell history) or into a file you commit.
One operating-system account per person. A shared login shares the file and
the key.

OAuth, when a local client completes it: Carbon stores a hash of the token.
The raw token stays in the client. The authorize screen shows the redirect
host before the user picks a company. Registration of the OAuth client is
unauthenticated, so the consent screen is the check. On a private origin,
anyone who can open the ERP is on that network. The user should read the
redirect host before approving.

The Grok Bot marketplace plugin uses OAuth on purpose. It ships no key.

### Tenant and tool

- `companyId` and `userId` come from the credential. Tool arguments cannot switch company.
- Row-level security is the same boundary as the app.
- The catalog excludes, and the server rejects, tenant create/delete (`settings_insertCompany`, `settings_deleteSubsidiary`, `settings_seedCompany`), the service-role supplier-approval helper, the ungated `production_triggerJobSchedule` (use `production_scheduleJob`), and the user-scoped note, favorite, and training-completion mutations that cannot succeed under an API key.
- `search_tools` returns `READ`, `WRITE`, or `DESTRUCTIVE`. Show that classification. Wait for a yes before `call_tool` on a `WRITE`. Wait for a yes before `call_destructive_tool` on a `DESTRUCTIVE` operation. `call_tool` refuses a `DESTRUCTIVE` operation.

### Rate and plan

- API keys: 60 requests per minute by default, counted on the key. **Settings → API Keys** shows the limit. There is no field to change it.
- OAuth: the same 60 per minute, counted on the user, so extra tokens do not multiply it.
- Over the limit the call returns `429` with `Retry-After` and `X-RateLimit-*`.
- On Carbon Cloud, API and MCP access is a Business-plan feature. An OAuth request from a Starter company returns `402` from the MCP entitlement gate. API-key authentication rejects a Starter company with `403` before MCP handling. A missing API-key module scope is an MCP tool error, `API key lacks the required scope`, not HTTP `403`. Self-hosted, the Enterprise feature set requires a commercial license.

### Model vendor

A private origin keeps the Carbon port off the internet. It does not keep ERP
data inside the building after you read it.

Grok Build sends the conversation, including tool results, to xAI. Cursor and
Grok Bot send the conversation, including tool results, to the model behind
that product. Customer names, prices, inventory, quality records, and anything
else `call_tool` returns leave with the prompt. A View key on sales is a
decision to let that model see sales data. Drawings, costs, and controlled
technical data are part of that decision. Ask only for what this task needs.

---

## Choose an authentication mode

### OAuth (no key)

The Grok Bot marketplace plugin, Claude.ai, Claude Desktop, and ChatGPT add the
server by URL and authorize in the user's browser. The user picks which of
their companies to grant. The connection then acts as that user. Prefer this
for Grok Bot, and for a local client when the user wants their full role
instead of a scoped key.

Grok Build can omit the header and follow the `401` plus `WWW-Authenticate`
challenge. It opens the browser and stores the token locally. Use that only
when the browser on this computer can open `{{ORIGIN}}`.

### API key (local command and config clients)

Grok Build, local Cursor, Claude Code, VS Code, Codex, and any headless or CI
use authenticate with a bearer API key. The user creates it in **Carbon →
Settings → API Keys**. It is scoped to one company and to explicit module
permissions (View / Create / Update / Delete), rate-limited, and shown only
once. Ask the user to create a View-only key and provide it as
`CARBON_API_KEY` in the environment. Send it as `Bearer <api-key>`.

Use a **separate key per client**.

Whichever mode, the identity can never do anything the granting user can't
when the mode is OAuth, and can never do anything outside the key's scopes
when the mode is a key. `companyId` and `userId` always come from the
credential, never from tool arguments.

---

## Set it up in your client

### Grok Build (local)

Use this when you are the `grok` CLI on a computer that can open `{{ORIGIN}}`.
That includes loopback and a private network. Do not point Grok Build at a
different host than `{{MCP_URL}}`.

```bash
grok mcp add --transport http carbon \
  {{MCP_URL}} \
  --header 'Authorization: Bearer ${CARBON_API_KEY}'
```

Quote the header so the shell stores the variable name. The same block in
`~/.grok/config.toml`, with the file owner-read-only:

```toml
[mcp_servers.carbon]
url = "{{MCP_URL}}"
headers = { "Authorization" = "Bearer ${CARBON_API_KEY}" }
```

Omit `--header` only for the OAuth flow described above. Then run
`grok mcp doctor carbon`. In a session the tools are `carbon__search_tools`,
`carbon__describe_tool`, `carbon__call_tool`, and
`carbon__call_destructive_tool`.

### Cursor and Grok Bot (one marketplace plugin)

Cursor and Grok Bot share one connector. It is the **Carbon** plugin in the
Cursor Marketplace. Submitting `https://github.com/crbnos/carbon` at
`https://cursor.com/marketplace/publish` lists it for both. There is no second
form for Cursor. The plugin directory is `plugins/carbon`, indexed by
`.cursor-plugin/marketplace.json`. Cursor reviews the plugin before either
catalog shows it. A push does not publish it.

The plugin's server is fixed:

```
https://app.carbon.ms/api/mcp
```

There is no API key in the plugin. The first tool call opens Carbon OAuth. The
user picks a company. The plugin ships the working loop twice: a Cursor rule
at `rules/carbon-erp.mdc`, and a Grok Bot skill at `skills/carbon-erp/SKILL.md`.

Install it when `{{ORIGIN}}` is `https://app.carbon.ms`:

1. **Cursor:** Customize → Marketplace → search **Carbon** → Install.
2. **Grok Bot:** Settings → Plugins → search **Carbon** → Add.
3. When a tool call asks them to sign in, they approve the consent screen and pick the company.
4. Verify in that product's chat with `search_tools`. Do not write `~/.cursor/mcp.json` for this origin. `grok mcp doctor` on a laptop does not prove the Bot.

A Cursor Cloud Agent on this same plugin can call that public URL. It still cannot call a private origin.

When `{{ORIGIN}}` is anything else — EU Cloud, a private network, a
self-hosted host, or ITAR — do **not** install this plugin for this deployment,
and do **not** add a custom MCP URL so a cloud agent can see it. That would
publish a private origin, or send this company's data through the US Cloud
connector. Use the local Cursor file below, or Grok Build, against
`{{MCP_URL}}`.

EU Cloud (`https://app.eu.carbon.ms`) is public, and it is still a different
origin from the listing. Use a local client pointed at that origin's
`/api/mcp`.

If **Carbon** is not in the marketplace yet, say so and point at the submit URL
above. Do not invent a custom server as a stand-in.

On a team plan, an admin may need to allow the plugin before members can
install it. Each person still signs in with OAuth, because the plugin does not
carry a shared key.

### Cursor on a private origin

Use this only when `{{ORIGIN}}` is not `https://app.carbon.ms`, and you are
Cursor on a computer that can already open `{{ORIGIN}}`. Leave Cursor Cloud
Agents unused for that origin.

Write the **user** file `~/.cursor/mcp.json`, not a file in the repo, and
restrict it to the owner (`0600`):

```json
{
  "mcpServers": {
    "carbon": {
      "url": "{{MCP_URL}}",
      "headers": { "Authorization": "Bearer ${env:CARBON_API_KEY}" }
    }
  }
}
```

When this Cursor build expands `${env:CARBON_API_KEY}` in headers, keep the
key in the environment. When it does not, put the key only in that user file,
still never commit it.

In **Settings → MCP**, confirm the server lists the four tools. Add this user
rule under Cursor **Settings → Rules**, because the marketplace rule is not
installed for this origin:

```
The Carbon MCP server is already configured. Its tools are search_tools, describe_tool, call_tool, and call_destructive_tool.
Discover an operation with search_tools, read its schema with describe_tool, then run a READ or WRITE with call_tool. Run a DESTRUCTIVE operation with call_destructive_tool. call_tool refuses those.
Show the classification. Ask before any WRITE or DESTRUCTIVE call.
On 401, stop and ask for a new key. On 403, stop: on Carbon Cloud the company is on the Starter plan. A missing module scope is a tool error, not HTTP 403. On 429, wait for Retry-After.
```

### Claude Code

Run this command (the key stays in `CARBON_API_KEY`):

```bash
claude mcp add --transport http carbon \
  {{MCP_URL}} \
  --header "Authorization: Bearer ${CARBON_API_KEY}"
```

You can also omit the `--header` flag entirely — the server answers an
unauthenticated request with a `401` and a `WWW-Authenticate` header pointing at
its OAuth metadata, so Claude Code will start the browser OAuth flow on first
use. Use the header form when the user has a scoped key, the keyless form when
they'd rather authorize in the browser.

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
browser (OAuth). No key needed. The computer running Claude Desktop has to be
able to open `{{ORIGIN}}`.

### ChatGPT

**Settings → Connectors → Add** the MCP server URL `{{MCP_URL}}` and authorize in
the browser (OAuth). Available on the plans that support custom connectors.
ChatGPT's servers have to be able to open `{{ORIGIN}}`, so this path is for a
public origin.

### Any other MCP client

Any client that accepts a **streamable-HTTP** MCP server takes the same two
values: the URL `{{MCP_URL}}` and an `Authorization: Bearer <api-key>` header (or
OAuth if the client supports remote connectors). The config key that holds the
URL varies by client — some use `url`, some use `serverUrl` — so check that
client's MCP docs for the exact field name, then plug in the values above.
A client that runs in someone else's cloud follows the same public-origin rule
as Grok Bot.

---

## Verify the connection

Do not report success until you've actually reached the server. Confirm it by
listing the four meta-tools and running one read:

1. The client should now expose `search_tools`, `describe_tool`, `call_tool`,
   and `call_destructive_tool` (Grok Build namespaces them as
   `carbon__search_tools` and so on). If it doesn't, the server isn't
   connected — recheck the URL and header.
2. Call `search_tools` with a query like `"customers"` to confirm auth works and
   you get operations back.
3. Optionally `describe_tool` one of them and `call_tool` a `READ` operation to
   confirm data flows.

If a request comes back `401`, the key is missing, malformed, expired, or
deleted (recreate it in Settings → API Keys) — or a connector needs
re-authorizing. An API-key request from a Starter company returns `403` during
authentication, before MCP handling. A missing API-key module scope is an MCP
tool error, `API key lacks the required scope`, not HTTP `403`. An OAuth
request from a Starter company returns `402` from the MCP entitlement gate.
A `429` means you've exceeded the key's rate limit — the `X-RateLimit-*`
headers say when to retry.

---

## What you can do once connected

You act as the authorizing identity, across every module it can reach. In
natural terms:

- "Show all open sales orders due to ship this week."
- "Which purchase orders are past their promised receipt date?"
- "What's the on-hand quantity and reorder point for a part across locations?"
- "Draft a quote for a customer for 200 aluminum housings."
- "List every job behind schedule and who's assigned."

Reads are safe to run. Before a `WRITE` or `DESTRUCTIVE` operation, confirm the
intent with the user — the classification is right there in `search_tools` and
`describe_tool` output, so you always know which kind you're about to run.

When the open workspace is the Carbon source tree, `AGENTS.md` still governs
code changes. This MCP server is how you read and write ERP data.

---

## ✅ Done

When the four meta-tools are present and `search_tools` returns operations, the
Carbon MCP server is connected. Tell the user it's ready, which mode you used
(OAuth or API key), which client, and — if a key — remind them it's scoped and
revocable in Settings → API Keys.

## Resources

- Carbon API guide — https://docs.carbon.ms/api
- Connect over MCP — https://docs.carbon.ms/api/mcp
- Authentication — https://docs.carbon.ms/api/authentication
- Operations reference — https://docs.carbon.ms/api/operations
- API keys — https://docs.carbon.ms/docs/reference/api-keys
- Marketplace plugin — `plugins/carbon` in the Carbon repository
- Server manifest — {{ORIGIN}}/.well-known/mcp.json
