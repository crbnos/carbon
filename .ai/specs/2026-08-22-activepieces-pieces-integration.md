# Activepieces Pieces as Third-Party Integration Actions in Carbon Workflows

> Status: draft
> Author: Claude (autonomous planning session for Brad)
> Date: 2026-08-22
> Research: `.ai/research/activepieces-pieces-integration.md`

## TLDR

Carbon workflows get a third-party integration surface by executing Activepieces
"pieces" — the MIT-licensed connector catalog at
`github.com/activepieces/activepieces` `packages/pieces/community` (727 pieces,
published continuously to npm as `@activepieces/piece-<name>`) — inside Carbon's
own workflow engine. **Feasibility is proven, not assumed**: the published npm
artifacts are self-contained single-file CJS bundles (framework and all
third-party deps inlined by esbuild; only Node builtins external; verified
firsthand by loading `@activepieces/piece-slack@0.17.9` in plain Node and
enumerating its 72 actions, typed props, dynamic-dropdown resolvers, and OAuth2
metadata). The import mechanism is **pinned npm packages behind a curated
manifest** — NOT a git submodule — feeding a generated piece catalog, a new
`integration` workflow node kind, a per-company `pieceConnection` store
(vault-backed, mirroring the 2026-08-15 integration-secret pattern), and a
child-process execution harness in `@carbon/jobs` that supplies the small
`ActionContext` surface pieces actually use. v1 is **actions only**; polling
triggers and webhook triggers are phased follow-ons.

## Problem Statement

Carbon's workflow engine (shipped 2026-07/08) can act only on Carbon itself: the
action catalog is 4 record creates, 10 generated `<entity>.update`s, `notify`,
and a raw `webhook`. Customers who want "when a sales order is created, post to
the #orders Slack channel / create a HubSpot deal / add a Google Sheets row"
today get a bare webhook and a homework assignment. Maintaining hundreds of
first-party connectors is intractable and off-mission. The research
(`.ai/research/activepieces-pieces-integration.md`) found that **no
manufacturing ERP embeds an open connector catalog** — Katana, Fulcrum,
JobBOSS2, Odoo, NetSuite all punt to Zapier/iPaaS partners — so this is
genuinely differentiating, and Activepieces is the only maintained open catalog
whose license permits it (n8n and Windmill gate embedding behind sales-led
commercial licenses; commercial embedded-iPaaS means vendor-cloud execution and
per-tenant fees).

## Feasibility Findings (what this session verified)

Firsthand (documented here because they drive every decision below):

1. **Published pieces are self-contained.** `@activepieces/piece-slack@0.17.9`
   is a ~210 KB tarball: one esbuild bundle (`src/index.js`, 557 KB) with
   `@slack/web-api`, zod 4, and the pieces-framework **inlined**; `dependencies: {}`;
   only Node builtins external; per-locale i18n JSONs included. Their CI
   (`release-pieces.yml`) publishes this shape for every piece on merge to main,
   with two hard gates (no `workspace:*`, no `@activepieces/*` deps may survive).
2. **Loading requires nothing of theirs.** `require()` the bundle, find the
   export whose `constructor.name === 'Piece'` (their own `extractPieceFromModule`
   rule), and you have `displayName`, `logoUrl`, `auth` (with OAuth2
   authUrl/tokenUrl/scopes), `actions()`/`triggers()` maps, per-action typed
   `props`, and callable `run(ctx)` / dynamic `options()` functions.
3. **The runtime contract pieces actually use is small.** Scan of all 727
   community pieces: effectively all use `auth` + `propsValue` + HTTP; `store`
   (139 pieces) is almost entirely polling-trigger dedupe state; `files.write`
   58; `server.*` 11; pause/waitpoints 9; `connections.get`/`output.update` 0.
   68% of pieces have zero third-party runtime deps. Implementing
   `auth + propsValue + store + files` covers ~95% of the catalog.
4. **Activepieces itself always runs a piece in a fresh child Node process**
   (even in `UNSANDBOXED` mode), building the context from HTTP callbacks to its
   server. Their engine's props coercion/validation pass (`props-processor.ts` +
   `processors/`) is pure and vendorable.
5. **OAuth2 refresh is a host responsibility.** Their server refreshes tokens
   at connection-read time (lock per connection; refresh when
   `now + 15min >= claimed_at + expires_in`) and hands pieces a fresh
   `access_token` with `refresh_token` redacted. Pieces never refresh themselves.
6. **Licensing is clean MIT** (everything outside `packages/ee`), including the
   framework and all community pieces. Their embed SDK / white-label builder is
   enterprise-licensed (~$36k/yr) — irrelevant here since we embed pieces in our
   engine, not their builder. Caveats: the npm artifacts carry no `license`
   field (MIT is inherited from the repo — ship an upstream attribution NOTICE),
   and piece `logoUrl`s hotlink `cdn.activepieces.com` with no stated stability
   policy (mirror logos at catalog-generation time).
7. **Known sharp edges**: their shared `httpClient` sets
   `NODE_TLS_REJECT_UNAUTHORIZED='0'` per request (bundled into pieces — one
   more reason for child-process isolation with a scrubbed env); `piece.auth`
   may be an **array** of auth options (Slack: OAuth2 + bot token); `SecretText`
   auth is `{ type, secret_text }` at runtime but older pieces read it as a bare
   string (their context-versioning shim handles this — pin recent piece
   versions and pass V1 shapes); prop values must go through their processors
   before `run()`.

**Verdict: feasible, with the real engineering in Carbon-side plumbing**
(connections + OAuth apps, catalog surfacing, output typing), not in running the
pieces themselves.

## Proposed Solution

Five components, phased. v1 = Phase 1 (actions only).

```
packages/pieces (new pkg, @carbon/pieces)
├── manifest.json          # curated allowlist: { name, version, sha512 } per piece
├── scripts/generate.ts    # npm fetch → verify hash → extract metadata → emit
│                          #   catalog.generated.ts (browser-safe JSON metadata)
│                          #   + mirrored logos → apps/erp/public/pieces/
├── src/catalog.ts         # typed read surface over the generated metadata
├── src/harness/           # Node-only: child-process runner, ActionContext impl,
│                          #   vendored props processor, OAuth2 refresh
└── NOTICE                 # upstream MIT attribution (npm artifacts lack license field)
```

### 1. Import mechanism: pinned npm packages, generated catalog

A committed `manifest.json` lists the curated pieces with **exact versions and
integrity hashes**. `pnpm run generate:piece-catalog` installs them (regular
`dependencies` of the new package, so pnpm lockfile + provenance apply), loads
each bundle in a subprocess, extracts metadata (piece → actions → props → auth),
and emits a committed, browser-safe `catalog.generated.ts` plus mirrored logo
assets. Version bumps are ordinary PRs with reviewable metadata diffs — never
auto-`latest` (the Sept-2025 npm worm is the cautionary tale; see research §6).

Rejected alternatives (research §Implications):
- **Git submodule**: requires their Turborepo+Bun toolchain to build 727
  workspace packages; drags a ~1 GB repo in-tree; loses per-piece semver. The
  published bundles make it strictly worse than npm.
- **Activepieces engine as sidecar**: undocumented internal protocol, EE
  coupling (ActiveBoxes had to polyfill EE interfaces), their sandbox CVE
  record, a second server to operate.
- **Their embed SDK**: enterprise-licensed and embeds *their* builder — defeats
  the premise.

### 2. Catalog surfacing: a new `integration` node kind

Piece actions do NOT enter `WORKFLOW_ACTION_CATALOG` (the closed, drift-checked
set stays closed; `BUILT_IN_ACTIONS` untouched). Instead:

- One new entry in `NODE_KINDS` (`packages/workflows/src/definition/nodes.ts`)
  — the designed extension point; the mapped type forces handles/checks/loopList
  completeness. Node data: `{ piece: { name, version }, action: string,
  connectionId: string, inputs: Record<string, ValueOrRef> }`. Adding a node
  kind adds a schema variant; existing documents still parse — **no definition
  format-version bump, no `migrateDefinition` entry**.
- One new entry in `EXECUTORS` (`packages/workflows/src/runtime/executors.ts`),
  so permission and work come from the same registry line. The executor resolves
  each input through the ONE resolver (variables, templates, items all work
  inside piece props), then calls a new `WorkflowServices.runPiece(...)` port
  method — the runtime stays pure; adding the method to the interface makes the
  jobs-side implementation a compile error to omit.
- Builder: a new `NODE_FORMS.integration` config form — piece picker (searchable,
  mirrored logos, grouped by category) → action picker → props form. Piece
  `PropertyType`s map onto existing Carbon controls:

  | Piece property | Carbon control (existing) |
  |---|---|
  | SHORT_TEXT / LONG_TEXT | `InlineValueEditor` (variables work) / `TemplateField` |
  | NUMBER / CHECKBOX / DATE_TIME | `NumberField` / `Switch` / `DatePicker` |
  | STATIC_DROPDOWN / STATIC_MULTI_SELECT | `Select` / `MultiChoiceField` from embedded options |
  | DROPDOWN / MULTI_SELECT_DROPDOWN (dynamic) | new `DynamicOptionsField` → options API route (below) |
  | JSON / OBJECT | JSON editor (webhook-body precedent) |
  | MARKDOWN | rendered help text |
  | ARRAY / FILE / DYNAMIC / CUSTOM / OIDC / COLOR / RICH_TEXT / DATE_RANGE | **v1: unsupported** — actions requiring one are filtered from the generated catalog (the generator records the exclusion count) |

- Validation: the `integration` NODE_KINDS entry checks required props present,
  types coherent, connection selected, piece+action exist in the generated
  catalog. Not-installed piece or missing connection = `INCOMPLETE_CONFIG`-class
  issues, blocking activation like today.
- Labels/i18n: piece display names are vendor strings; they ride the
  `useWorkflowLabel(key, fallback)` untranslated-fallback path (round-2
  precedent for per-company names). Piece i18n JSONs exist per locale and can be
  wired in later.
- The generated catalog metadata is **not** bundled into the main ERP chunk
  (25–40 pieces of full prop metadata is MB-scale) — the builder loads it
  lazily via a route/dynamic import.

### 3. Connections: `pieceConnection` + vault + own OAuth apps

New first-class per-company connection store (the research's clearest finding:
auth is the real cost center, not code):

- New table `pieceConnection` (SQL below): multiple named connections per piece
  per company (two Slack workspaces is a legitimate ask). Non-secret config in a
  JSONB column; secret material in **Supabase Vault** via new
  `upsert/get/delete_piece_connection_secret` RPCs — the exact
  service-role-only SECURITY DEFINER pattern of
  `20260817122916_integration-secret-vault.sql`, keyed by connection id.
- Auth types in v1: `SECRET_TEXT`, `BASIC_AUTH`, `CUSTOM_AUTH` (paste-credential
  forms rendered from the piece's auth metadata) work for **every** piece with
  no per-provider setup. `OAUTH2` is supported only for providers where Carbon
  configures its own OAuth app via env (`PIECE_<PROVIDER>_CLIENT_ID/SECRET` —
  the existing `SLACK_CLIENT_ID` pattern; Carbon already operates Slack, Xero,
  QuickBooks, OnShape, Jira apps). A generic callback route
  `/api/integrations/pieces/oauth` does state-verified code→token exchange using
  the piece's own `tokenUrl` metadata. Pieces whose only auth is OAuth2 without
  a configured env app appear in the catalog as "coming soon"/disabled with the
  reason.
- **No `secrets.activepieces.com` proxy.** Their shared OAuth apps are a feature
  of their platform (and paid, for overrides); riding them from a foreign
  product is a contractual/abuse gray zone (research §5). Google
  restricted-scope pieces (Gmail/Drive) are deliberately deferred — their app
  verification is ~6 weeks + annual CASA assessment.
- Token refresh: jobs-side `refreshPieceConnection` mirroring their semantics —
  per-connection lock (Redis, `@carbon/kv`), refresh when
  `now + 15min >= claimed_at + expires_in`, persist through the vault RPC, hand
  the piece a V1-shaped `AppConnectionValue` with `refresh_token` withheld.
- UI: connections are managed where they're used — a "Connections" section on
  the workflows surface (`workflows` module owns it; service functions in
  `workflows.service.ts` per the one-service-per-module rule) plus inline
  "Connect" from the builder node form. Install/manage requires the same gate as
  integrations today (`settings_update` on the routes is NOT right — see
  Decision D14: connection CRUD routes gate on `workflows_update`, matching
  where the feature lives; the INTEGRATIONS plan gate still applies).

### 4. Execution: child-process harness behind `WorkflowServices.runPiece`

The jobs-side implementation (`packages/jobs/src/workflows/actions/piece.ts` +
the harness in the new package):

- **Secret access decision (explicit rule change).** The engine rule says the
  only privileged access is the two run-log tables; vault RPCs are
  service-role-only. The piece executor adds a second narrowly-scoped
  privileged surface: `runPiece` resolves the connection secret with the
  service-role client **after** re-verifying, through the owner-scoped client,
  that the owner can read that `pieceConnection` row (RLS) and holds the
  node's declared permission. The secret goes into the child process IPC
  payload only — never into step outputs, never into the runtime, and
  `redactForLog` already masks `access_token`/`secret`-named keys. This is the
  same shape as `claimStep`'s privileged writes: a named, auditable exception,
  documented in `workflow-engine.md` when implemented.
- **Child process per call** (their own model, even unsandboxed): spawn with a
  **scrubbed env** (no Supabase keys, no DB URLs — neutralizes the bundled
  `NODE_TLS_REJECT_UNAUTHORIZED='0'` blast radius to the one call), IPC
  `serialization: "advanced"` for Buffers, hard timeout (default 30 s), memory
  cap via `--max-old-space-size`, kill on settle. The child loads the bundle,
  runs the vendored props processor, builds the `ActionContext`
  (store/files/stubs below), calls `run(ctx)`, returns `{ output }` or a typed
  error.
- **Context implementation**: `store` → new `pieceStore` KV table (needed in
  earnest for Phase 2 polling; trivial now); `files.write` → Supabase storage
  private bucket + signed URL return; `tags`/`output`/`flows`/`project` →
  stubs; `run.stop/respond` → recorded halt flag mapped to the failure handle;
  waitpoints → refused with a clear error (9-piece long tail; Inngest
  `step.waitForEvent` mapping is a possible later phase); `server.*` → dead
  values (catalog generator flags pieces that touch `ctx.server`).
- **Output logging cap**: the executor serializes the piece result and applies
  a write-time bound (depth/keys/list caps, reusing `compactForLog`'s
  constants) before it reaches `workflowStepRun.output` — the write-time
  redactor only truncates strings, and a third-party API response is the first
  unbounded-object source in the system (webhook's 2048-byte excerpt is the
  precedent).
- **Network posture**: pieces call vendor APIs by design, so the webhook DNS
  deny-list applies at the harness level as a default undici dispatcher in the
  child (best-effort — vendor SDKs with their own agents bypass it; documented
  as such, not oversold). No egress allowlist exists today anywhere; not
  introduced here.

### 5. Dynamic options + outputs

- **Options route**: `POST /api/workflows/piece-options` — body
  `{ piece, action, property, connectionId, propsValue }`; `requirePermissions`
  (`workflows_update`) + plan gate; resolves the connection (same privileged
  path), runs the piece's `options()` in the harness with a short timeout;
  returns `DropdownState` (label/value pairs). Builder's `DynamicOptionsField`
  calls it on open/refresher change, with the piece's declared `refreshers`.
  Errors degrade to a disabled state with the piece's message (their UX).
- **Outputs**: a new `{ kind: "json" }` `ValueType`/`RuntimeValue`. An
  integration node declares one output, `result: json`. Property access into a
  `json` value is **runtime-checked, not build-checked**: the validator accepts
  any path under a json-typed reference; at run time a missing path is the
  existing "skip with a reason" semantics (missing data is never an error).
  This is a deliberate, contained relaxation of "every reference validates" —
  confined to the one kind, mirroring how Activepieces/Zapier/Make all treat
  step output, and honest about the fact that third-party response shapes are
  not knowable at build time. In templates a json value renders as compact
  JSON; scalar leaves compare/render as their primitive type. When a piece
  declares `outputSchema` (newer, optional field), the generator additionally
  emits typed named outputs so refs validate normally.

### Phasing

| Phase | Scope | New infra |
|---|---|---|
| **1 (v1)** | Curated piece **actions** in the builder; connections (secret/basic/custom + env-gated OAuth2); dynamic dropdowns; run history parity | everything above |
| **2** | **Polling triggers** (157 pieces use `pollingHelper`) | `pieceStore` in anger; scheduler ride-along on the existing `nextRunAt` bookmark + `syncWorkflowTriggers` transactional lifecycle (`onEnable`/`onDisable` at activate/deactivate); default 5-min cadence; fan-out of returned items to runs |
| **3** | **Webhook triggers** | public per-workflow webhook URL route + payload storage + renewal cron; `APP_WEBHOOK` (shared app-level webhooks, e.g. Slack events) stays out of scope |
| Later | waitpoints→Inngest mapping, per-company custom piece install, piece i18n, more OAuth apps | — |

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Import mechanism | Pinned npm `@activepieces/piece-*` behind a curated manifest; NOT submodule/sidecar/embed-SDK | Published bundles are self-contained (verified); submodule = their build toolchain + 1 GB repo; sidecar = undocumented protocol + EE coupling; embed SDK = enterprise license |
| D2 | Catalog model | Committed `catalog.generated.ts` from the manifest; closed `WORKFLOW_ACTION_CATALOG` untouched | Reviewable diffs, drift-checkable, browser-safe metadata; keeps the existing catalog's closed-set guarantees |
| D3 | Node model | New `integration` node kind (one `NODE_KINDS` + one `EXECUTORS` entry) | The designed extension point; avoids forcing piece props through `CatalogInput` or polluting the action picker with hundreds of entries; no format-version bump needed |
| D4 | Execution | Child process per call in `@carbon/jobs`, scrubbed env, vendored props processor | Their own model even unsandboxed; contains `NODE_TLS_REJECT_UNAUTHORIZED='0'`; crash/memory isolation; secrets via IPC only |
| D5 | Connections | New `pieceConnection` table (multi per piece per company) + vault RPCs keyed by connection id | `companyIntegration` PK forbids multiples and would spam the integrations list; vault pattern is proven (2026-08-15 spec) |
| D6 | OAuth strategy | Own OAuth apps per provider, env-gated; no Activepieces shared-app proxy; Google restricted scopes deferred | Research §5: shared apps are their platform's paid feature; Google restricted = 6-week review + annual CASA |
| D7 | Secret access in engine | `runPiece` resolves vault secrets service-role AFTER owner-scoped RLS + permission re-check; named exception like the run-log tables | Vault RPCs are service-role-only by design; the alternative (granting users decrypt) is strictly worse |
| D8 | Node permission | `{ module: "workflows", action: "update" }` on the integration executor; connection CRUD routes ditto; plan gates = `WORKFLOWS` + `INTEGRATIONS` | Piece actions touch external systems, not ERP rows — RLS-module mapping doesn't apply; avoids new RBAC (Ask-First territory) |
| D9 | Output typing | New `json` ValueType with runtime-checked paths; typed outputs when `outputSchema` exists | Third-party shapes unknowable at build time; missing-data-skips semantics already exist; industry-standard UX |
| D10 | Supply chain | Exact versions + integrity hashes; official `@activepieces` scope only in v1; bumps are reviewed PRs | Their CI publishes on merge with maintainer review; external community pieces get NO review since PRs were paused; npm worm precedent |
| D11 | Logos/branding | Mirror logos at generation time into Carbon's assets; nominative use of third-party marks | No CDN hotlink policy exists; brand-guideline compliance per research §2 |
| D12 | Attribution | `NOTICE` file with upstream MIT text in the new package | npm artifacts carry no license field; MIT attribution is the only obligation |
| D13 | Unsupported prop types | Actions using ARRAY/FILE/DYNAMIC/CUSTOM/etc. filtered out at generation, count logged | Ship the 80% without building every widget; no silent truncation |
| D14 | Multi-tenancy (heuristic 1) | `pieceConnection`/`pieceStore`: `companyId`, composite PK, `id('prefix')`, audit columns, RLS | House rules |
| D15 | Service shape (heuristics 2, 6) | Connection CRUD in `workflows.service.ts`/`workflows.models.ts` (workflows module owns it); `{data, error}` returns | One service/models per module; connections exist for workflows |
| D16 | Forms (heuristic 5) | Connection forms = `ValidatedForm` + zod validator generated per auth type + route action | House rules |
| D17 | Backward compat (heuristic 7) | No frozen surface touched: definition format unbumped (new variant only), closed catalogs unchanged, run-history schema unchanged | New node kind is additive; old definitions parse |
| D18 | Trigger scope | v1 actions-only; polling P2; webhook P3; APP_WEBHOOK never (needs per-app webhook secrets + event demux) | Each trigger class needs real host infra; actions deliver the visible value first |
| D19 | Piece version pinning | Manifest pins one version per piece globally; node stores `{name, version}` for observability; runs execute the installed version; validator warns on drift | Per-workflow version pinning (their model) adds a multi-version install cache Carbon doesn't need at this scale |
| D20 | v1 curation criteria | (a) auth feasible without heavyweight verification, (b) manufacturing-relevant (accounting, e-commerce, shipping, CRM, comms — per Katana's catalog), (c) light deps. Starter list ~25: Slack, Teams, Discord, Telegram, HubSpot, Salesforce, Pipedrive, Airtable, Notion, Monday, Asana, Trello, ClickUp, Google Sheets*, SendGrid, Mailchimp, Stripe, Shopify, WooCommerce, ShipStation, QuickBooks*, Xero*, OpenAI, Anthropic, HTTP-adjacent utilities excluded (native webhook exists). *=OAuth app already operated or standard-scope | Product call — flagged for veto; the mechanism is version-controlled so the list is cheap to change |

## Data Model Changes

```sql
-- Connections (Phase 1)
CREATE TABLE "pieceConnection" (
    "id" TEXT NOT NULL DEFAULT id('pcon'),
    "companyId" TEXT NOT NULL,
    "pieceName" TEXT NOT NULL,          -- "@activepieces/piece-slack"
    "name" TEXT NOT NULL,               -- customer's label, e.g. "Ops workspace"
    "authType" TEXT NOT NULL CHECK ("authType" IN ('SECRET_TEXT','BASIC_AUTH','CUSTOM_AUTH','OAUTH2')),
    "config" JSONB NOT NULL DEFAULT '{}',   -- non-secret props only
    "secretRef" TEXT,                        -- vault.secrets id (pattern of 20260817122916)
    "status" TEXT NOT NULL DEFAULT 'Active' CHECK ("status" IN ('Active','Error')),
    "statusReason" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "pieceConnection_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "pieceConnection_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pieceConnection_name_unique" UNIQUE ("companyId", "pieceName", "name")
);
ALTER TABLE "pieceConnection" ENABLE ROW LEVEL SECURITY;
-- Policies per conventions-database.md: SELECT/INSERT/UPDATE/DELETE on
-- workflows_* permissions, companyId-scoped.

-- Vault RPCs: upsert/get/delete_piece_connection_secret(p_company_id, p_connection_id, ...)
-- SECURITY DEFINER, REVOKE from PUBLIC/anon/authenticated, GRANT service_role only,
-- AFTER DELETE trigger drops the vault row (all mirroring 20260817122916).

-- Piece KV store (Phase 1 schema, Phase 2 workload: polling dedupe state)
CREATE TABLE "pieceStore" (
    "id" TEXT NOT NULL DEFAULT id('pkv'),
    "companyId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,              -- 'workflow:<workflowId>' | 'company'
    "key" TEXT NOT NULL,
    "value" JSONB,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "pieceStore_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "pieceStore_key_unique" UNIQUE ("companyId", "scope", "key"),
    CONSTRAINT "pieceStore_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- 512 KB value cap enforced in the service layer (their STORE_VALUE_MAX_SIZE).
```

No changes to `workflowRun`/`workflowStepRun` or any existing table.

## API / Service Changes

- `packages/workflows`: `integration` entry in `NODE_KINDS` + schema variant;
  `EXECUTORS.integration`; `runPiece` added to `WorkflowServices`;
  `{ kind: "json" }` added to `ValueType`/`RuntimeValue` + resolver/compare
  handling; validator rules for the new kind. (ES2019/browser-safe: no piece
  code enters this package — metadata types only.)
- New package (`packages/pieces`): manifest, generator, catalog read
  surface, harness (Node-only export path).
- `packages/jobs`: `actions/piece.ts` implementing `runPiece` (connection
  resolve + refresh, child-process call, output capping); `services.ts` wires
  it into `createWorkflowServices`.
- `apps/erp` routes: `POST /api/workflows/piece-options`; piece OAuth install +
  callback (`api+/integrations.pieces.$pieceName.install.ts` / `.oauth.ts`);
  connection CRUD routes under the workflows surface. All behind
  `requirePermissions` + `requirePlan({ feature: "WORKFLOWS" })` (+
  `INTEGRATIONS` for connection install).
- Connection service functions in
  `apps/erp/app/modules/workflows/workflows.service.ts` (+ models), `{data, error}`
  shape, `companyId`-scoped.

## UI Changes

- Builder: `NODE_FORMS.integration` (piece picker → action picker → props form);
  `DynamicOptionsField`; connection selector with inline "Connect" (popup →
  OAuth or credential form); node card shows the mirrored piece logo (first
  per-action icon surface — net-new, precedent is kind-level icons only).
- Workflows surface: Connections list/detail (Drawer overlay per house
  convention) with status, "reconnect" on Error.
- Run history: integration steps name themselves via the existing
  `useNodeLabel` fallback (piece action display name); step detail shows capped
  input/output like any node.
- NodePalette: `integration` kind entry (icon `LuPlug` or similar).

## Acceptance Criteria

- [ ] `pnpm run generate:piece-catalog` produces a committed catalog for the
      manifest; CI check fails on drift (mirrors `check:workflow-catalog`).
- [ ] A user with `workflows_update` creates a Slack connection (OAuth) and an
      Airtable connection (API key) under Workflows → Connections; secrets are
      absent from `pieceConnection.config` and present only via vault RPC
      (verified by direct table select).
- [ ] In the builder, adding an integration node, picking Slack → "Send Message
      To A Channel", the channel dropdown populates from the live workspace via
      the options route; the message field accepts `{` variables from upstream
      nodes.
- [ ] Activating a workflow "sales order created → Slack message" and creating
      a sales order posts the message; the run history shows the step Succeeded
      with redacted auth in `input` and a size-capped `output`.
- [ ] A piece action referencing `result.ts` of the Slack step in a downstream
      condition resolves at run time; a bogus path skips with a reason, not an
      error.
- [ ] Killing the child process mid-run (timeout test) settles the step Failed
      with a readable error; the run is marked Failed; no orphan processes.
- [ ] A workflow owned by a user who loses `workflows_update` fails at the
      integration node with the standard permission message.
- [ ] An expired OAuth token is refreshed transparently before the call
      (integration test with a short-lived token); a revoked one flips the
      connection to Error with the reason surfaced in Connections UI.
- [ ] Community edition + non-Cloud editions: feature available (plan gates
      short-circuit, existing behavior); Cloud without Business/Partner plan:
      gated with upgrade prompt.
- [ ] `pieceConnection` rows are invisible cross-company (RLS test).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Upstream contract drift (context versioning, bundle shape changes — repo just migrated nx→turborepo+bun) | Med | Exact-version pinning + generator validates shape at bump time; the harness targets the published-bundle contract, not the repo; context-version shim vendorable if needed |
| Child-process spawn on Vercel serverless (jobs execute via the ERP's Inngest route) | Med | Node runtime supports `spawn`; bundle piece files via `includeFiles`/nft tracing; fallback = in-process execution with env scrubbing at reduced isolation (explicitly flagged if taken); measure lambda size (~25 pieces ≈ 25–50 MB, within limits) |
| Supply-chain compromise of a pinned piece | Med | Integrity hashes; official scope only; scrubbed child env (no Carbon secrets exposed); review diffs on bump; connection secret is the blast radius — document per-piece scopes |
| OAuth app operational burden (per-provider registration, redirect URIs, scope reviews) | Med | v1 ships env-gated providers Carbon already operates + API-key auths for everything else; Google restricted scopes deferred |
| `json` value kind weakens build-time validation guarantees | Med | Confined to one kind; runtime missing-path = existing skip-with-reason; typed outputs when `outputSchema` present |
| Piece bundle misbehavior (TLS-verification disable, global mutation, hangs) | Low-Med | Child process per call, scrubbed env, hard timeout, memory cap, kill on settle |
| Unbounded third-party outputs bloating `workflowStepRun` | Low | Write-time capping in the executor (compact constants), plus existing nightly compaction |
| Activepieces CDN/logo or metadata API disappearing | Low | Logos mirrored at generation; catalog is committed; no runtime dependency on their infra |

## Open Questions

> Autonomous session — no human was available mid-run. Every question below is
> resolved per the spec-writing skill's autonomous protocol (codebase precedent
> → research consensus → recommendation) and marked **Autonomous** for veto.
> None was left to "figure out during implementation."

- [x] npm packages vs git submodule vs engine-sidecar vs embed SDK? —
      **Autonomous:** pinned npm packages (D1). The published-bundle discovery
      makes this near-conclusive; the user's submodule suggestion was evaluated
      and rejected on build-toolchain coupling and reviewability grounds.
- [x] New node kind vs entries in the existing action catalog? —
      **Autonomous:** new `integration` node kind (D3). Keeps the closed
      catalog closed and piece props out of `CatalogInput`.
- [x] How do piece outputs enter Carbon's typed value system? —
      **Autonomous:** new `json` ValueType with runtime-checked paths (D9).
      The deepest type-system change here — **most worth a human look**.
- [x] Connection model: reuse `companyIntegration` or new table? —
      **Autonomous:** new `pieceConnection`, multiple per piece (D5).
- [x] What permission gates integration nodes? — **Autonomous:** existing
      `workflows_update`; no new RBAC module (D8). Auth/RBAC is Ask-First
      territory — this choice deliberately avoids touching it, but confirm.
- [x] OAuth: own apps vs Activepieces' shared apps vs a managed-auth vendor
      (Nango et al.)? — **Autonomous:** own apps, env-gated per provider;
      defer Google restricted scopes (D6). Legal/product sensitivity — confirm.
- [x] Triggers in v1? — **Autonomous:** no; actions-only v1, polling P2,
      webhooks P3 (D18). Scope call — confirm.
- [x] Which pieces in the v1 manifest? — **Autonomous:** criteria + ~25
      starter list (D20). Pure product call — cheap to change, please edit.
- [x] Child process vs in-process execution? — **Autonomous:** child process
      (D4), with the Vercel-deployment caveat in Risks.
- [x] Service-role secret access from the engine (rule exception)? —
      **Autonomous:** narrowly-scoped exception with owner-side re-check (D7).
      Second-most worth a human look.
- [x] Where does the code live / is it EE-licensed? — **Autonomous:** new
      community-licensed package (harness is generic glue over MIT code);
      gating stays at the plan layer like workflows today (D8, D12).
- [x] Logos: hotlink or mirror? — **Autonomous:** mirror at generation (D11).

## Changelog

- 2026-08-22: Package name settled by Brad: `packages/pieces` / `@carbon/pieces`
  (was provisionally `pieces-runtime`). Note this is Carbon's own package —
  distinct from upstream Activepieces' `packages/pieces` directory referenced
  in the research.
- 2026-08-22: Created after autonomous feasibility study. Firsthand
  verification: loaded `@activepieces/piece-slack@0.17.9` from npm in plain
  Node; inspected bundle externals, auth metadata, dynamic-dropdown resolvers.
  Four research reports (pieces framework, execution engine, Carbon builder +
  integration infra, external/licensing/security) synthesized; findings in
  `.ai/research/activepieces-pieces-integration.md`. All open questions
  resolved autonomously and flagged for veto — no implementation started.
