# Phase 5 research — actions, entity operations, lookups

Condensed from four codebase sweeps (dispatcher/auth, notifications, webhooks, phase-4
engine seams). Every claim below was read out of the code on branch `feat/automation`.

---

## 1. The engine seams phase 5 must fill

| # | Seam | Where | What has to change |
|---|---|---|---|
| 1 | Executor registry | `packages/workflows/src/runtime/executors.ts:8-13` | Add `lookup`, `entity`, `action`. Nothing else in the engine switches on `node.type`. |
| 2 | `NOT_AVAILABLE` | `packages/jobs/src/workflows/engine/execute.ts:55,84` | Becomes unreachable for those kinds; keep as the defence. |
| 3 | Permission **action** | `execute.ts:89` | Hardcoded `"view"`. `hasPermission` already supports `create/update/delete`. A writing action needs a wider `NodeExecutor.permission` return. |
| 4 | `RuntimeContext` | `packages/workflows/src/runtime/types.ts:26-33` | Only `{catalog, loader, outputs, item?}`. **No owner-scoped client.** Built at `execute.ts:96-100`. |
| 5 | `ctx.item` | `execute.ts:96` | Declared but never set by the engine; only `filter.ts:44` injects it locally. |
| 6 | `itemKey` | `execute.ts:115` | Hardcoded `""`. Batch needs `itemKeyFor(item)`. |
| 7 | Step id | `execute.ts:274` | `` `node:${nodeId}` `` needs a deterministic per-item suffix. |
| 8 | `workflowStepRun.input` | `engine/ledger.ts:53-84` | Column exists (migration line 154), engine never writes it. |
| 9 | `getAction`/`getOperation` | `packages/workflows/src/catalog/catalog.ts` | Stubs: `options.getAction?.(id)`. `execute.ts:155` calls `createEventCatalog()` with no options, so both always return `undefined`. |
| 10 | `CatalogAction`/`CatalogOperation` | `packages/workflows/src/definition/catalog.ts:21-33` | No `permission` field (unlike `CatalogEvent`). |
| 11 | `write` allowlist | `catalog/entities.ts` + `catalog/build.ts:29-38` | `RegistryEntry` is `table | label | permission | article? | watch?`. No `write` key exists anywhere. |
| 12 | Loader table map | `engine/loader.ts:29` | `REGISTRY_ENTRIES[entity]?.table` is the only entity→table map, so Lookup can only reach registry entities. |
| 13 | Lost-claim replay | `execute.ts:119-121` | Always returns `Skipped`; the phase-4 spec wanted a terminal row's output reused. |
| 14 | Tests | `runtime/executors.test.ts:17-20` | Asserts the three kinds are `undefined`. |

**Lookup already validates clean.** `NODE_KINDS.lookup.configured` gates on `getEntity`,
which is real — so a lookup node passes activation today and fails only at run time with
"This kind of step is not available yet." Action and Entity gate on the two stubs, so they
genuinely cannot be activated.

**Lookup cannot name the record it is searching.** `lookup.data.match` is
`clauseSchema[]` (`left: valueOrRef`, `operator`, `right: valueOrRef`), and `loopList` is
`undefined` so `{kind:"item"}` is illegal there. There is no form that means "the candidate
record's `status`". This is the same shape of gap phase 4 found in Filter.

**Reference executors:** `runtime/condition.ts` and `runtime/filter.ts`. Both return
`permission: () => undefined`, so phase 5 writes the first non-undefined permission.
`NodeResult.Failed` already carries an optional `handle`, and `execute.ts:144` honours it —
so failure-handle routing needs no engine change.

**Batch machinery is built and unwired.** `runtime/batch.ts` exports `planBatch` (caps at
`MAX_LIST_ITEMS = 100`) and `itemKeyFor` (entity id, else `h:<fnv1a64>`). Grep confirms no
caller outside the barrel and its test.

---

## 2. Acting as the owner, and calling business logic

- `getUserScopedClient(userId, { workflowRunId })`
  (`packages/auth/src/lib/supabase/client.server.ts:14`) mints a **5-minute** HS256 JWT with
  a `workflow_run_id` claim and returns an **anon-key** client — RLS fully applies.
- `packages/jobs/src/workflows/engine/owner.ts` — `getOwnerClient`, `readOwnerPermissions`
  (reads `get_claims` **as the owner**, deliberately not the 1-hour-cached privileged path),
  and `hasPermission(permissions, module, action, companyId)` where `"0"` is the
  all-companies wildcard.

### The dispatcher is not reachable from the engine

- `executeFunction(functionName, context, args)` lives at
  `apps/erp/app/routes/api+/mcp+/lib/direct-executor.ts:84`. It imports `~/modules/*`, so
  **`packages/jobs` cannot import it** (`packages/jobs/package.json` has no app dependency,
  and grep finds zero `~/modules` imports under `packages/jobs/src`).
- It splits `<module>_<fn>`, builds positional args from `serviceParams`/`injectAuth` in the
  generated `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json` (1397 tools, regenerated
  by `scripts/generate-mcp.ts` and by the husky pre-commit hook), stamps
  `companyId`/`companyGroupId`/`createdBy`/`updatedBy`, and returns
  `{success:true,data} | {success:false,error}`.
- It does **no permission checking** — only a one-entry blocklist
  (`MCP_BLOCKED_TOOL_NAMES = ["settings_seedCompany"]`). All authorization is RLS.
- `tool-metadata.json` has **no permission-module field**, and `ExecutorContext` needs a
  `companyGroupId` the workflow `RunPayload` does not carry.

### What the engine *can* reach today

- Owner-scoped Supabase reads/writes (`.from(table)`), including the RPC
  `get_next_sequence` (`apps/erp/app/modules/settings/settings.service.ts:395`) for readable ids.
- Supabase edge functions via `client.functions.invoke(...)` — but the `create` function is
  narrow (`nonConformanceTasks`, `purchaseOrderFrom*`, `receipt*`, `shipment*`, `journalEntry`),
  not general document creation.
- Shared Kysely business engines in `packages/database/src/*` (e.g. `quality.ts` uses
  `getNextSequence`) — but Kysely **bypasses RLS**, which conflicts with acting as the owner.

---

## 3. Notify

- One event, `carbon/notify` (`packages/lib/src/events.ts:16-35`), handled by
  `packages/jobs/src/inngest/functions/notifications/notify.ts`. It already does in-app +
  email + Slack, per-person opt-outs, plan gating and digesting.
- **Every message string is built by looking up the source document** — one switch,
  `buildEventContent` in `notifications/content.ts:137-1187`, ~27 cases, each doing its own
  `client.from(...)` read. There is no path for caller-supplied text: `EventContentOptions`
  (`content.ts:117-121`) carries only `{companyId, documentIds?, userId?}`.
- Adding a payload-text kind touches: `packages/lib/src/events.ts` (carry the text),
  `packages/notifications/src/index.ts` (new `NotificationEvent` + topic/heading/CTA cases),
  `content.ts` (`EventContentOptions` + a case that reads no table),
  `notify.ts` (`defaultDestinations` entry, forward the text, and the
  `documentId ?? documentIds[0]` guard at `:200-205` which currently throws
  `NonRetriableError` without one), `apps/erp/app/routes/api+/link.ts` (else the CTA lands on
  the app root), and `apps/erp/app/components/Layout/Topbar/Notifications.tsx:198-418`
  (**without a case the in-app row renders `null` — invisible**).
- No migration needed: `notification.event` / `.topic` are plain `TEXT`.
- **Roles are groups.** An `employeeType` is mirrored 1:1 into a `group` row with the same id
  (`20230123004632_groups.sql:68-78`), and each user has an identity group whose id **is** the
  user id — so one mixed array of user ids and group ids resolves uniformly through
  `users_for_groups(text[])` (`:310-324`). That RPC is `SECURITY DEFINER` with **no tenant
  check**, which is why `notify.ts:290-305` re-filters against `userToCompany`.
- Opt-outs: `notificationPreference` (`userId, companyId, channel ∈ {email,slack}, topic,
  enabled`), absence of a row = enabled, in-app never filtered.

---

## 4. Call an outside URL

Two systems, **neither signs anything**.

- **System A (the customer-facing one):** `webhook` table → per-table Postgres triggers →
  `pg_net` → edge function `packages/database/supabase/functions/webhook/index.ts`. One
  `fetch`, **no retries, no dedupe, no timeout**, only `Content-Type: application/json`.
  Counters `successCount`/`errorCount`. Plan-gated on `WEBHOOKS`. The docs state the
  at-most-once and no-signing behaviour explicitly
  (`docs/content/docs/building/webhooks.mdx`).
- **System B (live code, no producer):** `eventSystemSubscription` with
  `handlerType = 'WEBHOOK'` → PGMQ → `packages/jobs/src/inngest/functions/events/webhook.ts`.
  38 lines: `axios.post(url, data, { headers: config.headers })` with `retries: 3`,
  `idempotency: "event.data.msgId"`, and `concurrency: { limit: 0, key: "<table>-<recordId>" }`.
  **`limit: 0` is not a documented Inngest value** (already flagged in the phase-3 spec).
  Nothing in the repo ever inserts a WEBHOOK subscription row.
- Zapier (`packages/ee/src/zapier/config.tsx`) is an inactive registry stub, not a system.
- **No outbound signing exists anywhere.** No `svix`, no `standard-webhooks`, no
  `x-signature`. Inbound verifiers to mirror: Slack
  (`packages/ee/src/slack/lib/client.ts:117-150` — versioned base string
  `v0:<ts>:<body>`, hex HMAC-SHA256, 5-minute replay window) and Paperless Parts
  (`apps/erp/app/routes/api+/webhook.paperless-parts.$companyId.ts:17-30` — Stripe-style
  `t=<ts>,v1=<sig>` header, **per-company secret read from `companyIntegration.metadata`**).
- **Secret storage:** there is no vault, no pgsodium, no application-level encryption.
  Precedents are a plaintext JSON blob (`companyIntegration.metadata`), a plaintext column
  (`apiKey.key`), an env-level single secret, or derive-don't-store
  (`assemblerCallbackToken` = `HMAC(SESSION_SECRET, "<purpose>:<id>")`).
- **No SSRF protection at all.** Only `z.string().url()`. No scheme/port restriction, no
  private-IP denylist, no DNS pinning, no redirect cap (axios follows up to 21), no timeout,
  no response-size cap. Retries spanning hours also mean a Slack-style 5-minute replay window
  would reject late attempts.

---

## 5. The entity registry as it stands

`packages/workflows/src/catalog/entities.ts` — 10 triggerable entities
(`purchaseOrder`, `salesOrder`, `job`, `item`, `receipt`, `shipment`, `quote`, `supplier`,
`customer`, `nonConformance` — labelled "Issue") and 5 reference-only
(`user`, `jobOperation`, `salesInvoice`, `purchaseInvoice`, `location`).
`watch` keys are bound to the table by `ColumnOf<T>`, so a renamed column fails to compile.

Known constraints from `.claude/rules/workflow-event-catalog.md`:

- Stored document totals (`purchaseOrder.orderTotal`) live only on **views**, which carry no
  trigger and are not dot-readable — they were explicitly deferred to phase-5 Entity operations.
- `packages/workflows` must stay ES2019-safe and browser-safe (no `node:crypto`,
  no BigInt literals) because `apps/erp` compiles its source.
- Runtime dependencies are only `zod`, `@carbon/utils`, `@lingui/core`.
