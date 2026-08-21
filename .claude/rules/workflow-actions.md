---
description: Workflow actions and operations — the two hand-written catalogue sources plus the entity `write` allowlists, and the job-side executors that carry them out as the workflow's owner. Read before adding an action, an operation, or anything a workflow can write or call.
paths: ["packages/jobs/src/workflows/actions/**", "packages/workflows/src/catalog/actions.ts", "packages/workflows/src/catalog/operations.ts"]
---

# Workflow Actions and Operations

What a workflow can *do* (actions), and what it can *work out* (operations).
"Workflow" here is the customer-facing feature — not the
`.claude/rules/workflow-*.md` procedure files.

Catalog: `workflow-event-catalog.md`. Engine: `workflow-engine.md`.
Matcher: `workflow-matcher.md`.

## Where the catalogue comes from

```
packages/workflows/src/catalog/actions.ts     HAND-WRITTEN  the actions with no generic form
packages/workflows/src/catalog/operations.ts  HAND-WRITTEN  read-only computations
packages/workflows/src/catalog/entities.ts    HAND-WRITTEN  `write` allowlist per entity
                    │
                    ▼  scripts/generate-workflow-catalog.ts → buildCatalog (pure)
packages/workflows/src/catalog/actions.generated.ts   COMMITTED
      WORKFLOW_ACTION_CATALOG  +  WORKFLOW_OPERATION_CATALOG   (one file, both maps)
packages/workflows/src/catalog/labels.generated.ts    COMMITTED  labels for events, actions and operations
```

Today: **16 actions** (6 hand-written, 10 generated `<entity>.update`) and
**15 operations**. Same commands as the event side — one generator writes all
three `*.generated.ts` files:

```bash
pnpm run generate:workflow-catalog
pnpm run check:workflow-catalog
```

`buildCatalog(registry, moments, actions, operations, schema)` expands each
entity's `write` map into one `<entity>.update` action: an input keyed by the
entity name (the record, `required: true`), plus one optional input per writable
column typed from the swagger schema. It sets `update: { entity }` and
`permission: { module: entry.permission, action: "update" }`, and labels it
`Update a/an <entity>`. A hand-written id that collides with a generated one is a
**build error**, not a silent overwrite.

A hand-written action must have either a `call` (an MCP tool name) or be one of
`BUILT_IN_ACTIONS` (`notify`, `webhook`) — `validateCatalogInputs` reports
`Action "<id>" has no implementation route.` otherwise. The check script also
verifies every `call` exists in `apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json`
and tells you to run `pnpm run generate:mcp`.

## `write` is an allowlist; `watch` is not

They look symmetric in `entities.ts` and are not. A watched column is **inert** —
it only decides whether an announcement becomes an event; the worst a wrong entry
does is fire or fail to fire a trigger. A written column is an **effect the
workflow performs as the owner**, so the default must be "no". Hence
`write` lists exactly the 34 columns across 10 entities that a workflow may set,
and `buildCatalog` additionally refuses `id`, `companyId`, `createdBy`,
`createdAt`, `updatedBy`, `updatedAt` (`UNWRITABLE_COLUMNS`) even if someone lists
them.

The two maps are independent. `quote.write` includes `customerReference`, which
nothing watches; `job.watch` includes `status` and `scrapQuantity`, which nothing
may write. Adding a column to `watch` does not make it writable, and that is the
point.

Both maps are keyed by `ColumnOf<T>` for the entry's own table, so a migration
that renames a column fails `tsgo` at the registry line. `write` entries carry
the same `ref` escape hatch as `watch` for composite foreign keys, and a `ref`
that disagrees with a present foreign key is a build error.

## The dispatcher seam

`packages/jobs` cannot import `~/modules/*` — the dependency only runs app → package.
But the four `*.create` actions must go through the ERP's own `upsert*` service
functions, so sequence numbers, defaults and required-field logic are the ones the
app already uses.

So `packages/jobs/src/workflows/actions/dispatcher.ts` holds one module-level
slot:

```ts
export function setWorkflowDispatch(fn: WorkflowDispatch): void
export function getWorkflowDispatch(): WorkflowDispatch | undefined
```

`apps/erp/app/routes/api+/inngest.ts` fills it at boot:

```ts
import { functions, inngest, setWorkflowDispatch } from "@carbon/jobs/inngest";
import { executeFunction } from "./mcp+/lib/direct-executor";

setWorkflowDispatch(executeFunction);
```

`WorkflowDispatch` is declared to be **structurally** satisfied by
`executeFunction`, so nothing in `@carbon/jobs` names an app type. An unfilled
slot is not a crash: `runAction` returns
`"This step is not available in this environment."`

`runCreateAction` (`actions/create.ts`) converts each `RuntimeValue` with
`toPlainValue`, dispatches, then digs the new row's id out of whatever came back
— the service functions return a Supabase envelope whose `error` it checks
separately, and `idIn` walks a list if one came back. No id means
`"The record was created but could not be read back."`, never a silent success.
`companyId`, `createdBy` and `updatedBy` are stamped by the dispatcher.

## `createWorkflowServices` — the one port

`packages/workflows/src/runtime/types.ts` declares `WorkflowServices`
(`runAction`, `runOperation`, `search`). It is **required** on `RuntimeContext`,
so a missing implementation is a compile error. The pure runtime knows nothing
else about the world.

`packages/jobs/src/workflows/actions/services.ts` is the only implementation.
`createWorkflowServices` closes over the owner's client plus `companyId`,
`companyGroupId`, `ownerId`, `runId` and `workflowId`. `execute.ts` builds it in
`contextFor`, i.e. **once per step**, on the same freshly minted five-minute
owner client the loader gets.

`runAction` routes off the **catalog**, never off the shape of the id:

```ts
const action = catalog.getAction(actionId);
const route  = getActionRoute(actionId);
if (action === undefined || route === undefined) return { ok: false, error: GONE };
if (route.update !== undefined) …   // runUpdateAction
if (route.call   !== undefined) …   // runCreateAction
return { ok: false, error: GONE };
```

An id that *reads* like `x.update` but carries no `update` block must not reach
the update executor. `getActionRoute` (`catalog/catalog.ts`) exists precisely so
`call`/`update` stay off `CatalogAction`, which the builder's validator reads.
`notify` and `webhook` are matched by id before the lookup because they have
neither.

`runOperation` (`actions/operations.ts`) needs **both** a declaration in
`WORKFLOW_OPERATIONS` and an entry in its own `COMPUTATIONS` map; either one
missing refuses with `"This calculation is no longer available."` rather than
falling through. It never throws into the walk — a broken read is a failed node.
`quote.total` is declared and deliberately always refuses: a quote line prices
several quantity breaks and the customer picks one, so no single read can answer
it.

`search` (`actions/search.ts`) backs the Lookup node. Operators map to PostgREST
exactly as `runtime/compare.ts` defines them — `contains`/`startsWith`/`endsWith`
use `ilike` because those three ignore case and `eq`/`neq` do not — and it fetches
`MAX_LIST_ITEMS + 1` newest-first so an over-cap list is detectable.

Every one of these reads and writes through the **owner's** client, so RLS still
applies and the write carries the run tag. See `workflow-engine.md`.

## The update executor, in order

`actions/update.ts`, and the order is the contract:

1. `REGISTRY_ENTRIES[entity].table` — an unknown entity refuses.
2. The input keyed by the entity name must be an `entity` value, else
   `"This step needs a record to update."`
3. **The target must exist in this company** (`existsInCompany`). Read through the
   owner's client, so RLS-refused and genuinely absent collapse to one answer —
   the customer cannot use the error text to probe another tenant.
4. Build the field map with `toPlainValue`; a column with an `enum` in the swagger
   schema rejects anything outside it (`"X" is not a valid status.`).
5. **Every foreign-key field must also exist in this company.** For each field
   whose catalog input type is `entity`, `existsInCompany` again.
6. `.update({ ...fields, updatedBy: ownerId, updatedAt: now }).eq("id", …).eq("companyId", …)`.

Step 5 is a **tenancy guarantee, not a nicety**. Nothing upstream constrains where
an entity id came from — it may have been resolved from another node's output, a
lookup, or a literal the builder saved. Postgres will happily accept a foreign key
whose composite pair is wrong at the app level, so skipping the check would let a
workflow point one company's record at another company's row. Its message is
`"The <column> you chose is not in this company."`

### The `user` special case

`user` has **no `companyId` column** — membership lives on `userToCompany`. So
`existsInCompany` consults a small `MEMBERSHIP` map first:

```ts
const MEMBERSHIP = { user: { table: "userToCompany", column: "userId" } };
```

which makes the check `userToCompany.userId = id AND companyId = companyId`.
Every `assignee` / `salesPersonId` / `accountManagerId` / `estimatorId` write goes
through this path, so getting it wrong would fail every assignment action.

## `notify`

`actions/notify.ts` sends through `trigger("notify", …)` with
`event: NotificationEvent.Workflow`. A role **is** a group, and every user has an
identity group whose id is their user id, so `user` and `role` both become
`recipient: { type: "group", groupIds }` with no branching. The catalog declares
`requireOneOf: [["user", "role"]]`; the executor refuses with `"This step has
nobody to notify."` when both are absent. `subject` and `message` arrive already
rendered — nothing here reads a template. When the customer named no record, the
**run** stands in as the notification's subject (`documentId: aboutId ?? runId`).
`trigger` only queues, so the summary claims recipients, never delivery.

### Channels

`channels` is a multi-select catalog input — `t.list(t.string)` with
`choices: ["inApp", "email", "slack"]` and `defaultValue: ["inApp", "email"]`.
The executor keeps only the names that are real `NotificationDestination`s and
passes them as `destinations`; an empty or absent value **omits the field**, so
the notify job falls back to its default map for `NotificationEvent.Workflow`
(in-app plus email) — which is what a node saved before this input existed means.

Three things about it are load-bearing:

- **In-app cannot be switched off.** `notify.ts` force-adds
  `NotificationDestination.InApp` to every notification so the bell menu reflects
  everything, product-wide. The builder therefore shows it ticked and disabled
  rather than offering a switch that does nothing.
- **The input is optional, not required**, precisely because in-app is locked on:
  requiring it could only ever be satisfied trivially, and it would block publish
  on notify nodes saved before the field existed in a picker where the author
  cannot tick the one channel that is actually on.
- **Availability is a build-time concern.** Email needs `EMAIL_NOTIFICATIONS`
  (Business/Partner) and Slack needs the company's Slack integration active; the
  job skips a channel it cannot use with a `console.warn` at most. The builder
  disables the option and says why (`fields/choiceOptions.tsx`) — that is the only
  place the author ever finds out. "Unavailable" only blocks ADDING a channel; one
  already stored (the seeded `email` default on a company with no plan for it) stays
  removable, or the author is looking at a channel they cannot clear. Only a `LOCKED`
  choice is frozen. `fields/multiChoice.ts` `choiceState` owns that distinction.

## The webhook action

`actions/webhook.ts`. Four inputs, `url` and `method` required:

| Input | Shape |
|---|---|
| `url` | https address, guarded (below) |
| `method` | `choices: ["GET","POST","PUT","PATCH","DELETE"]`, `defaultValue: "GET"` |
| `headers` | a `pairs` value — named rows, each value a literal, reference or template |
| `body` | a template, `showWhen: { input: "method", equals: ["POST","PUT","PATCH"] }` |

`defaultValue` is a builder-side seed only: `ActionForm` writes it into `inputs` the moment
the action is picked, and nothing reads it at run time. `webhook.ts` still falls back to
`POST` when `method` is absent, which is what a definition saved before the input existed
relies on — and, since `method` is now required, is the only way an absent method reaches
the runtime at all.

Only `POST`, `PUT` and `PATCH` carry a body: for any other method the `body` property is
**absent from the `fetch` init object entirely**, because `fetch` throws on a GET with a
body and this file collapses a throw into `"The address could not be reached."`, which
would read as a network fault. `Content-Type: application/json` is added only on those
three methods, and only when the customer set no content type of their own.

Eight header names are refused — `Host`, `Content-Length`, `Connection`,
`Transfer-Encoding`, `Upgrade`, `TE`, `Keep-Alive`, `Proxy-Authorization`. They frame the
request rather than describe it, so setting one changes how the message is delivered, not
what it says. The list is enforced **twice**: in `nodes.ts` at validation time (so the
builder reddens the row) and again in `webhook.ts` at run time, because a definition saved
as a draft is never validated. A row with a blank name or an empty value is dropped, and a
later row replaces an earlier one of the same name whatever its casing.

**Header values are masked in run history** — `redactForLog` masks a `pairs` by shape, so
every value is `[REDACTED]` while every name stays readable. See `workflow-engine.md`.

No signing — if a customer needs request verification they add an auth header.
`redirect: "manual"` and a 10s `AbortSignal.timeout`. A 3xx is refused
(`"That address redirected, which is not allowed."`) — following it would leave
the guard behind. Non-2xx reports the status. On success the action outputs
`status` and puts up to 2048 bytes of the response body in the step summary.

### The SSRF guard

`actions/url-guard.ts`, `checkOutboundUrl(raw)`, called before the fetch:

- `https:` only; anything else is `"Only https addresses are allowed."`
- Resolves the hostname with `dns.promises.lookup(..., { all: true })` — a public
  name can still point inward, so the name alone proves nothing.
- Rejects if **any** resolved address is private, not just the first: a name can
  resolve to both a public and a private address.
- v4: `0.0.0.0/8`, `127/8`, `10/8`, `172.16–31`, `192.168/16`, `169.254/16` (which
  covers the cloud metadata address `169.254.169.254`), and everything `>= 224`.
  A malformed address is treated as private.
- v6: `::`, `::1`, `fc00::/7` unique-local, and anything whose first byte is
  `0xfe` (link-local). An IPv4-mapped `::ffff:a.b.c.d` is re-tested as v4 — it is
  only as safe as the address it wraps.

`checkOutboundUrl` alone would not stop DNS rebinding — its answer and `fetch`'s are
two separate resolutions, and whoever owns the name controls both. So the same range
check runs a second time as `guardedLookup`, installed as `connect.lookup` on the
exported `outboundDispatcher` (an undici `Agent`) that `webhook.ts` passes to `fetch`.
That is the lookup the socket itself performs, so the address approved is the address
dialled. It validates **every** address the resolver returns, not just the one it
hands back, and fails closed on an empty answer.

`webhook.ts` imports `fetch` from `undici` rather than using the global one **on
purpose**: the global is backed by whichever undici Node bundled (6.22 on Node 22),
and a dispatcher from a different major is rejected at request time with
`invalid onRequestStart method`. Importing both from the same package keeps them in
step across Node upgrades.

The dispatcher is not reached for a **literal IP** — `net.connect` skips `lookup`
when the host is already an address. That case is covered by `checkOutboundUrl`, and
covered completely: a literal cannot rebind, because there is no name to re-resolve.
The two layers are what make the guard whole, so don't drop the pre-check as
"redundant".

## The two older webhook systems are untouched

Three things in this repo are called "webhook". Only the first is new:

| | What | Where |
|---|---|---|
| **Workflow action** | Outbound, SSRF-guarded, https-only | `packages/jobs/src/workflows/actions/webhook.ts` |
| Event-system `WEBHOOK` handler | Outbound `axios.post` on `carbon/event-webhook` to a subscription's configured URL with its configured headers — **no signing, no URL guard** | `packages/jobs/src/inngest/functions/events/webhook.ts` |
| Integration webhooks | **Inbound** routes for Jira, Linear, Paperless Parts, Stripe and Xero | `apps/erp/app/routes/api+/webhook.{jira,linear,paperless-parts,stripe,xero}*.ts` |

They share no code with the workflow action and were deliberately not changed.
Do not "unify" them: the event-system handler's contract is an existing customer
integration, and hardening it is its own decision with its own migration. The
matcher's subscription reconciler is already careful never to touch a company's
`WEBHOOK` rows (see `workflow-matcher.md`).

## Gotchas

- `runAction`'s three refusal strings are customer-facing and distinct on purpose:
  `GONE` ("This step is no longer available.") means the catalog no longer has it,
  `NO_DISPATCH` means the dispatcher was never injected, `UNKNOWN_RESULT` means a
  `call` action declares no `record` output to hand back.
- `toPlainValue` lives in `actions/values.ts` and is imported by BOTH `update.ts` and
  `create.ts` so they convert identically. Don't fork it.
- `update.ts` and `search.ts` both cast the client to an untyped `SupabaseClient`
  before `.from(table)`. The table is only known at run time, and typing it costs a
  ~350-way instantiation `apps/erp` cannot afford.
- `actions.generated.ts` is generated. Never hand-edit it — `check:workflow-catalog`
  compares data, not text, and names the action whose inputs, outputs or permission
  drifted.
- An action's `batchable` flag is catalog data; the batching itself belongs to the
  engine, which calls `actionExecutor` once per item. `runtime/action.ts` never
  loops — one step row must stand for one effect.
