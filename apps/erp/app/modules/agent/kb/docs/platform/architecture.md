# Architecture

> One journey from a button click, through the server, into Postgres, out to background jobs, and back to the screen.

Carbon is software that runs a manufacturing business: what it buys, what it holds in stock, what it
builds, what it ships, and whether the quality held up. Two separate apps do that. The **ERP** is the
office app, where people quote, purchase, plan and invoice. The **MES** is the shop floor app, used on
tablets next to the machines to run and record the actual work.

This page follows one journey. A user clicks a button, something is saved, other things happen because
of it, and the screen updates. Everything else hangs off that spine. [Part 1](#part-1-the-map) and
[Part 2](#part-2-follow-one-click-all-the-way-down) are the ones to read in order; the rest stands on
its own, so take it in any order you like.

Any term you might not know is marked with a number the first time it appears, like this:
Postgres [[17]](#g17). The number links to a one-line definition in the [Glossary](#glossary) at the
end. Nothing is assumed.

The file paths, line numbers and counts throughout are accurate as of August 2026. They will drift as
the repository moves; the ideas they illustrate outlast them.

---

## Part 1: The map

Carbon is a monorepo [[10]](#g10): one Git repository holding several applications and
about twenty-five shared libraries, built together by pnpm workspaces and
Turborepo [[25]](#g25). Two of those applications are the products people log into, the
ERP and the MES. Everything else exists to serve them.

The centre of gravity is a single Postgres [[17]](#g17) database. Almost every arrow in
this doc eventually points at it. Unusually for a web app, a lot of logic that you might
expect to live in application code lives _inside_ the database instead: permissions,
computed totals, and the "something changed" notifications. That is the single most
important thing to understand about Carbon, and [Part 3](#part-3-layer-by-layer) explains why.

Colour is used sparingly in these diagrams, and it means the same thing in all of them:
**blue** is our own apps, **pink** is stored state, **amber** is work that happens in the
background. Everything else is left plain on purpose.

**The five things worth taking from that picture:**

1. **The ERP app is the hub.** It serves pages, and it is also where background jobs
   execute. Inngest [[5]](#g5) does not run our code on its own machines; it calls back
   into the ERP container: it is a timer and a queue that POSTs to `/api/inngest` saying
   "run this job now", and our own code does the work. See
   [Part 4](#part-4-what-happens-after-the-write).
2. **Most database access is not raw SQL.** It goes through PostgREST [[18]](#g18), a
   service that turns `client.from("purchaseOrder").select(...)` into a SQL query. We use
   the `supabase-js` library to talk to it.
3. **The database enforces permissions itself.** Even if application code forgets a
   filter, Postgres will not return another company's rows. (Except on one specific
   escape hatch: see [Part 3](#part-3-layer-by-layer).)
4. **Writes on the right tables cause events automatically.** Around ninety tables opt
   in to a database trigger, and where a company has subscribed to one, search indexing,
   webhooks, audit logs and customer automations all happen without the code that did the
   write knowing about them.
5. **The Rust service is optional.** It turns uploaded CAD files into 3D models the
   browser can show, and works out the order parts come apart in for assembly
   instructions. Carbon runs fine without it.

---

## Part 2: Follow one click all the way down

Here is the whole system in one story: **a buyer creates a Purchase Order.**

Pick this one apart and you have seen every layer: a form, validation, a permission
check, a database write, logic living in Postgres, a background side effect, and the
screen updating. Every other feature in Carbon is a variation on it.

### The short version

Notice the shape: the user's request finishes as soon as the row is written. The search
indexing happens afterwards, on its own, and nobody waited for it.

### The same story, with real files

Every path below is real. Open them in your editor as you read.

**1. The button.** It is a link, not a submit button.

`apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrdersTable.tsx:502`

```tsx
primaryAction={
  permissions.can("create", "purchasing") && (
    <New label={t`Purchase Order`} to={path.to.newPurchaseOrder} />
  )
}
```

Two conventions in three lines. `permissions.can(...)` hides UI the user is not allowed
to use; this is _cosmetic only_, the real check happens on the server. And the URL comes
from `path.to.*`, a single registry of every URL in the app
(`apps/erp/app/utils/path.ts`, ~2,200 lines). **Never hardcode a URL string.**

**2. The form.** `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderForm.tsx:116`

```tsx
<ValidatedForm
  method="post"
  validator={purchaseOrderValidator}
  defaultValues={initialValues}
>
```

`ValidatedForm` is our wrapper around a plain HTML form. You hand it a schema; it blocks
submission and shows inline field errors if the data is wrong, and it re-displays server
errors in the same place. Fields (``, ``) come
from `~/components/Form`, which re-exports generic inputs plus about ninety
Carbon-specific pickers (Customer, Supplier, Item, Location, Currency…).

**3. The schema.** `apps/erp/app/modules/purchasing/purchasing.models.ts:127`

```ts
export const purchaseOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  purchaseOrderId: zfd.text(z.string().optional()),
  purchaseOrderType: z.enum(purchaseOrderTypeType, {
    /* ... */
  }),
  supplierId: z.string().min(1, { message: "Supplier is required" }),
  locationId: zfd.text(z.string().optional()),
});
```

zod [[28]](#g28) is a schema library: you describe the shape of the data once, and get
both runtime validation and a TypeScript type from it. `zfd` (`zod-form-data`) handles the
fact that HTML forms send everything as strings: `zfd.text()` turns an empty field into
`undefined` rather than `""`.

**One schema, used in three places:** the browser validates against it, the server
re-validates against it, and the service function's argument type is derived from it. That
is why the three can never drift apart.

**4. The route.** `apps/erp/app/routes/x+/purchase-order+/new.tsx:29`

```ts
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "purchasing",
      bypassRls: true,
    });

  const formData = await request.formData();
  const validation = await validator(newPurchaseOrderValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const result = await insertPurchaseOrder(client, {
    ...validation.data,
    companyId,
    companyGroupId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(
        request,
        error(result.error, "Failed to insert purchase order")
      )
    );
  }
  throw redirect(path.to.purchaseOrder(result.data.id));
}
```

This is the shape of _every_ write in Carbon:

> **assert the method → check permissions → validate → call a service → redirect.**

A file under `apps/erp/app/routes/` can export up to three things that matter here:

| Export              | Runs where                 | Job                         |
| ------------------- | -------------------------- | --------------------------- |
| `loader` [[8]](#g8) | server only                | fetch the data a page needs |
| `action` [[1]](#g1) | server only                | handle a form submission    |
| `export default`    | server first, then browser | the React component         |

`loader` and `action` are stripped out of the JavaScript sent to the browser, so it is
safe to use secrets and database clients in them. This is the same idea as Next.js
server components or a traditional controller; the file just happens to hold both
halves.

**5. The service function.** `apps/erp/app/modules/purchasing/purchasing.service.ts:1393`

Routes never talk to the database directly. They call a _service function_: a plain
function whose first argument is a database client and which returns Supabase's raw
`{ data, error }` without throwing.

```ts
const seq = await client.rpc("get_next_sequence", {
  sequence_name: "purchaseOrder",
  company_id: input.companyId,
});

const order = await client
  .from("purchaseOrder")
  .insert({
    purchaseOrderId,
    supplierId: input.supplierId,
    status: "Draft",
    companyId: input.companyId,
    createdBy: input.createdBy /* ... */,
  })
  .select("id, purchaseOrderId")
  .single();

const [delivery, payment] = await Promise.all([
  client.from("purchaseOrderDelivery").insert({
    /* ... */
  }),
  client.from("purchaseOrderPayment").insert({
    /* ... */
  }),
]);

if (delivery.error || payment.error) {
  await deletePurchaseOrder(client, orderId); // manual undo
  return { data: null, error: delivery.error ?? payment.error };
}
```

That last block is the honest, ugly truth about `supabase-js`: **three `.insert()` calls
are three separate HTTP requests, so they are not a transaction.** If the second fails,
the first is already committed, and we have to undo it by hand. When you need a real
transaction, use Kysely [[6]](#g6) instead. See
[Part 3.3](#33-the-service-layer-four-doors-to-the-database).

**6. What Postgres does by itself.** Two things happened that no TypeScript asked for.

_The order number._ `client.rpc("get_next_sequence", ...)` calls an RPC [[21]](#g21), a
function that lives _inside_ the database
(`packages/database/supabase/migrations/20241115101526_rpc-get-next-sequence.sql`). It
reads and bumps a counter and formats the result (`PO` + zero-padding + optional date
tokens) in a single atomic step. Doing this in application code would hand two
simultaneous buyers the same number.

_The event._ Every insert into `purchaseOrder` fires a Postgres **trigger**, a function
the database runs automatically on a write. It drops a small JSON message onto a queue
that lives in a database table. Nothing in the route knows this is happening. [Part 4](#part-4-what-happens-after-the-write)
follows that message to the end.

**7. The screen updates.** The action ends with `throw redirect(...)`. React Router
follows the redirect and runs the destination's `loader`, which re-reads from the
database and renders the finished page. There is no client-side cache to invalidate and
no "add the new row to the list in state" code. **After any non-GET submission, React
Router automatically re-runs the loaders for the current page.** That is the whole
refresh mechanism.

---

## Part 3: Layer by layer

### 3.1 The browser and the route file

The apps are **React Router v7** in framework mode: server-rendered React, where a
single file owns both a URL's data-loading and its UI. (It is not Remix and not Next.js,
though it is the direct descendant of Remix.) Vite [[27]](#g27) builds it; Tailwind v4
styles it.

**Routes are files on disk.** `apps/erp/app/routes/` has about 1,400 of them, and the
folder structure _is_ the URL structure, with a few conventions:

| In a filename   | Means                                                                              |
| --------------- | ---------------------------------------------------------------------------------- |
| `x+/`           | a URL segment and a folder: `x+/purchase-order+/new.tsx` → `/x/purchase-order/new` |
| `_public+/`     | a folder for grouping that adds **no** URL segment                                 |
| `_layout.tsx`   | a wrapper shared by every route in the folder                                      |
| `$orderId`      | a URL parameter: `$orderId.tsx` → `/:orderId`                                      |
| `.` in the name | a `/` in the URL: `dimensions.new.tsx` → `dimensions/new`                          |
| `_index.tsx`    | the page for the folder's own URL                                                  |
| `*.server.ts`   | ignored by the router; a helper file that never reaches the browser                |

Top-level namespaces: `x+` is the logged-in app (66 module folders), `api+` holds JSON
endpoints with no UI, `_public+` is login/logout, and `share+` is the _unauthenticated_
surface: links you email to a customer to view a quote.

**Getting data in.** A `loader` runs on the server, calls service functions, and returns
plain JSON; the component reads it with `useLoaderData<typeof loader>()`. Data shared by
the whole app (the current user, their company, their permissions, feature flags) is
loaded once in `apps/erp/app/routes/x+/_layout.tsx` (about eighteen parallel queries) and
read anywhere via hooks like `useUser()`, `usePermissions()`, `useCompanySettings()`.
Those hooks read the layout route's loader data, not a React context.

**Getting data out.** Forms post to an `action`, as in [Part 2](#part-2-follow-one-click-all-the-way-down). For writes that should
_not_ navigate (reordering rows, an inline edit, a delete button), use `useFetcher()`,
which posts in the background and still triggers the automatic revalidation.

**Shared UI.** Look in two places before writing a component:

- `packages/react/`: the design system (`@carbon/react`). Buttons, modals, comboboxes,
  menus, layout primitives. Built on Radix UI [[19]](#g19) and Tailwind.
- `apps/erp/app/components/`: app-level pieces. The big one is
  `components/Table/Table.tsx`, a single generic table (~1,500 lines, built on TanStack
  Table) that every list screen uses. It handles sorting, filtering, pagination, saved
  views, CSV import/export, column visibility and inline editing. You pass `data`,
  `columns` and `count`; the server does the paging via URL search params.

**Client state** is deliberately small. Reference lists that everything needs (items,
customers, suppliers, people) live in nanostores [[13]](#g13) and are kept fresh by
`RealtimeDataProvider`. Ephemeral UI state (is the search modal open) uses
zustand [[29]](#g29). User and permission data lives in _neither_; it comes from the
route loader.

**Translations** use Lingui [[7]](#g7): wrap a string in `` t`...`  `` or ``, run
`pnpm lingui:extract`, and translators fill in thirteen locale files.

**MES is the same stack, simpler.** No `modules/` folder: services sit flat in
`apps/mes/app/services/`, all validators in one `models.ts`, routes are one flat level,
and the UI is built for gloved hands on a tablet.

### 3.2 The gate: who is allowed to do what

Every server-side entry point in Carbon starts with the same call. There are about 1,600
of them.

```ts
const { client, companyId, userId } = await requirePermissions(request, {
  create: "purchasing",
});
```

Defined at `packages/auth/src/services/auth.server.ts:195`. It does four jobs at once:

1. **Identifies the caller.** Either from the session cookie (a browser) or from a
   `carbon-key` header (our public API, which additionally gets rate-limited and scope-checked).
2. **Loads their permissions.** Permissions are stored as `<module>_<action>` keys such
   as `purchasing_create` or `sales_view`, each mapping to the list of companies where the
   user holds it. They are fetched by a Postgres function called `get_claims` and cached
   in Redis for an hour. They are _not_ in the JWT.
3. **Refuses if they lack it.** Redirect to login if not signed in at all, or an "Access
   Denied" toast otherwise.
4. **Hands back a database client already scoped to this user**, plus their `companyId`
   and `userId`.

**Multi-tenancy** [[12]](#g12) is the reason for a lot of what follows: Carbon is one
database serving many customer companies. Nearly every table has a `companyId` column and
a composite primary key `("id", "companyId")`. Which company you are acting as is read
from your session cookie, never from the URL.

**RLS (Row Level Security)** [[20]](#g20) is the part worth understanding even if you
never write SQL. It is a Postgres feature where each table carries a rule that is silently
`AND`ed onto every query the database receives. Ours look like this:

```sql
CREATE POLICY "SELECT" ON "public"."reportPin"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
);
```

So if a query for another company's purchase orders reaches Postgres, it returns zero
rows. The tenant boundary is enforced by the database, not by us remembering a `.eq()`.
Service functions still filter by `companyId` anyway, as a second line of defence.

**The escape hatch.** Notice `bypassRls: true` in the Purchase Order action. RLS costs
real query time on hot paths, so for trusted employee requests we hand back a service-role
[[22]](#g22) client that skips it entirely. That is a deliberate trade, and it moves the
responsibility back to us: any loader using `bypassRls` must re-check the tenant by hand,
as the PO detail route does:

```ts
if (purchaseOrder.data?.companyId !== companyId)
  throw redirect(path.to.purchaseOrders);
```

**Three kinds of user** share one login system, distinguished by a `role` on their
company membership: `employee`, `customer`, `supplier`. Portal users get much narrower
permission sets, and routes can demand `{ role: "employee" }`. Separately, `share+/`
routes are fully unauthenticated; a long unguessable token in the URL is the credential.

### 3.3 The service layer: four doors to the database

A service function's first argument is always a client, and there is more than one kind.
Picking the wrong one is the most common mistake made here.

**1. The user-scoped client.** What `requirePermissions` normally returns. Every query
runs as that user with RLS applied. Use it unless you have a reason not to.

**2. The service-role client** (`getCarbonServiceRole()`) ignores RLS entirely. Needed
by background jobs (which have no logged-in user), by `share+/` routes, and by
`bypassRls: true` requests. **You are now the only thing standing between a bug and a
cross-tenant data leak.**

**3. Kysely** is a TypeScript SQL query builder that holds a real connection to Postgres,
so it can open a real transaction. This is the answer to the "three inserts aren't
atomic" problem from [Part 2](#part-2-follow-one-click-all-the-way-down):

```ts
return db.transaction().execute(async (trx) => {
  for (const { id, sortOrder, updatedBy } of updates) {
    await trx
      .updateTable("quoteLine")
      .set({ sortOrder, updatedBy })
      .where("id", "=", id)
      .execute();
  }
});
```

Three warnings. Kysely **throws** on failure rather than returning `{ error }`, so wrap it
in `try/catch`. It applies **no** RLS, so authorise before you call it. And the pool it
draws from is small (edge functions ask for exactly one connection,
`getConnectionPool(1)`): if code inside a transaction reaches for a second connection from
the same pool, that second request queues behind a transaction that cannot finish until it
is served, and the whole thing hangs until the timeout. Do all the work of a transaction
on the `trx` handle you were given, never on `db`.

**4. Edge functions** are small programs written for Deno [[2]](#g2), deployed next to the
database and called over HTTP [[4]](#g4). There are about forty in
`packages/database/supabase/functions/`, and they own the genuinely heavy work:
MRP [[11]](#g11), production scheduling, posting a shipment or an invoice to the general
ledger, CSV import, exporting a whole company. Call one and wait for its answer:

```ts
const { data, error } = await client.functions.invoke("post-shipment", {
  body: { type: "post", shipmentId, userId, companyId },
});
```

They exist for two reasons: they can hold a database connection and run a big
multi-thousand-row transaction properly, and they are callable from anywhere (the ERP,
the MES, a background job, the public API), not just from a route handler.

"Heavy" here means heavy in SQL, not heavy in the function. Supabase caps an edge function
tightly, a couple of hundred megabytes of memory and a short processor-time budget, far
below a normal server or an ordinary Lambda, so the useful pattern is to let Postgres do
the lifting and keep the function itself thin. Work that is heavy in JavaScript, or that
runs for minutes, belongs in an Inngest job instead; work that needs real computing power,
like CAD geometry, belongs in the Rust service.

There is also a fifth, narrower door: **RPCs**, plain Postgres functions called with
`client.rpc("name", args)`. About 85 call sites. `get_next_sequence` from [Part 2](#part-2-follow-one-click-all-the-way-down) is one.

### 3.4 The database

Postgres 15, wrapped by Supabase [[24]](#g24), an open-source bundle that adds an
auto-generated REST API (PostgREST), user authentication, file storage, a realtime change
feed, and the edge function runtime, all on top of one ordinary Postgres database.

Rough size, for a sense of scale: **923 migration files**, 362 tables,
101 views, 238 database functions, 154 enum types.

**Migrations** [[9]](#g9). Every schema change is a timestamped SQL file in
`packages/database/supabase/migrations/`, named `YYYYMMDDHHMMSS_kebab-name.sql`. Create
one with `pnpm db:migrate:new <name>`, apply with `pnpm db:migrate`. They are applied in
filename order and never edited after merge.

A typical table shows every convention at once:

```sql
CREATE TABLE "itarCertification" (
    "id" TEXT NOT NULL DEFAULT id('itc'),
    "companyId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);
ALTER TABLE "public"."itarCertification" ENABLE ROW LEVEL SECURITY;
```

`id('itc')` generates a prefixed, sortable, URL-safe id such as `itc_3xK9...`. The prefix tells
you what an id refers to at a glance.

**Views** [[26]](#g26) **are the read path.** This is the second-most-important idea in
Carbon after RLS.

We **write to tables** but **read from views**. A view is a saved query that behaves like
a table. `purchaseOrders` (plural, that is the naming convention) joins in the supplier
name, sums the line amounts into `orderTotal`, converts currency, counts received
quantities, and fetches a thumbnail. So the create path never calculates a total: it
inserts a header, and the view derives everything else on read.

When a list screen shows a number you cannot find in any table, look for the view. They
are defined in migrations, always with `WITH (security_invoker = true)` so the caller's
RLS still applies.

**Types are generated, never written.** `pnpm run generate:types` points the Supabase CLI
at your local database and writes `packages/database/src/types.ts`, about 80,000 lines
describing every table, view, function and enum. App code imports from it:

```ts
import type { Database } from "@carbon/database";
type PurchaseOrderRow =
  Database["public"]["Tables"]["purchaseOrder"]["Row"];
```

**Run `pnpm run generate:types` after pulling migrations or writing one, before you
typecheck.** Half of all "this property doesn't exist" errors are a stale types file.

**Logic that lives in Postgres.** We push logic into the database when it must hold true
for _every_ writer: the ERP, the MES, an edge function, a background job, the public
API, or someone running SQL by hand. Two examples:

- `update_picking_list_status()` is a trigger that recomputes a picking list's header
  status whenever one of its lines changes. Written from four different places;
  recomputing it in each caller would drift.
- `dispatch_event_batch()` is the event trigger from [Part 4](#part-4-what-happens-after-the-write). It must enqueue in the _same
  transaction_ as the write that caused it, so a rolled-back write never emits a
  phantom event.

**Files** live in Supabase Storage buckets: `private` is the workhorse (attachments,
drawings, quality records), `public` and `avatars` are self-explanatory, plus one bucket
per company and `temp-staging` for large CAD uploads.

---

## Part 4: What happens after the write

Back to that queued event. This chain is the piece most likely to surprise you, because
none of it is visible from the code that did the write.

It is not every write, though. A table only emits events once a migration has opted it in
with `attach_event_trigger('tableName')` — about ninety have — and even then the trigger
enqueues nothing unless that company has an **active subscription** matching the table and
the operation. So the same `UPDATE` can fan out to six handlers for one company and do
absolutely nothing for another.

Three unfamiliar pieces in that chain: PGMQ [[16]](#g16) is the queue, which lives in
ordinary Postgres tables so a trigger can write to it inside the same transaction;
pg_net [[15]](#g15) is what lets the database make the outbound HTTP ping after that
transaction commits; and Inngest [[5]](#g5) is the background job runner.

In plain terms, Inngest works like this: you send it a named event, it calls one of your
registered functions over HTTP, and it remembers how far that function got. Each
`step.run("id", fn)` inside a function is a checkpoint: if step four fails and retries,
steps one to three are not re-executed; their saved results are handed back. That is why
it is used for anything that must survive a crash.

The wiring is three files:

| What                             | Where                                 |
| -------------------------------- | ------------------------------------- |
| The client                       | `packages/lib/src/inngest/client.ts`  |
| The list of all 55 job functions | `packages/jobs/src/inngest/index.ts`  |
| The HTTP endpoint Inngest calls  | `apps/erp/app/routes/api+/inngest.ts` |

That last row is the surprising one: **background jobs run inside the ERP container.**
Inngest is a scheduler and a memory, not a compute host.

**Firing a job on purpose.** The automatic trigger path above is for row changes. When
code wants to _deliberately_ kick something off, it calls the typed helper `trigger()`
(about 108 call sites):

```ts
await trigger("notify", {
  event: NotificationEvent.JobAssignment /* ... */,
});
```

Event names are always `carbon/<something>`.

**Scheduled work** comes from two places. Inngest crons handle app-level jobs: MRP every
three hours, notification digests every fifteen minutes, exchange rates and audit
archiving nightly, workflow-run cleanup at 04:00. All of them are UTC, and any job that
needs a company's local day computes it inside the run. Database-level maintenance uses
pg_cron [[14]](#g14) instead, for refreshing cached aggregate tables and sweeping the event
queue.

**Notifications** fan out from one job (`packages/jobs/.../notifications/notify.ts`) to
three destinations: in-app rows (which the topbar picks up live over Realtime), email via
Resend, and Slack. `packages/notifications` itself is only the list of event types; it
sends nothing.

---

## Part 5: The other engines

### Workflows: the customer's own automations

Carbon ships a drag-and-drop canvas where a _customer_ builds "when a quote is accepted,
notify the account manager and create a job". Confusingly these are also called
workflows, and they are a completely different thing from Inngest jobs:

|            | Inngest jobs                  | Workflows                                |
| ---------- | ----------------------------- | ---------------------------------------- |
| Written by | us, in TypeScript             | customers, on a canvas                   |
| Stored as  | code                          | JSON rows in `workflowVersion`           |
| Runs as    | service role, sees everything | **the workflow's owner**, with their RLS |
| Changed by | a deploy                      | the customer, at any moment              |

They reuse the event pipeline from [Part 4](#part-4-what-happens-after-the-write), the `WORKFLOW` branch. A matcher takes the
row change, works out which catalog events it corresponds to, finds subscribed workflows,
and queues one run each. `packages/workflows` holds the pure definition/validation logic
and touches nothing; `packages/jobs/src/workflows/` holds the runtime that actually does
things. Every run and every step is recorded, so a customer can open a run and see what
happened.

### The Assembler: the Rust service

`apps/assembler` plus `crates/` is a Rust HTTP service that converts CAD files (STEP) into
web-renderable 3D (GLB) and plans a collision-free disassembly sequence for assembly
instructions. It wraps two C++ libraries (OpenCASCADE for geometry, FCL for collision).
`packages/viewer` renders its output in the browser.
It is entirely optional; everything else boots without it.

It is not a call-and-wait service. A job is submitted and answered later: the caller posts
the work and gets a job id back, then waits for a callback, with polling as a fallback.
Files never travel through the ERP. The caller hands over signed URLs, one to read the CAD
file from and one to write the result to, and the Rust service streams straight to and
from the storage bucket itself; it holds no database credentials and can see nothing else.
Redis is where job state and finished-result pointers live, which is why the service
refuses to start without it.

---

## Part 6: The repo map

**Applications** (`apps/`, plus `docs/` at the root):

| App         | What it is                                                                  | Dev port |
| ----------- | --------------------------------------------------------------------------- | -------- |
| `erp`       | The main product, and the host for all background jobs. By far the largest. | 3000     |
| `mes`       | Shop floor: job operations, work centres, scheduling. Touch-first.          | 3001     |
| `academy`   | Training app for new Carbon users.                                          | 4111     |
| `starter`   | A minimal example app showing auth + database + forms.                      | 4000     |
| `assembler` | The Rust CAD/3D service.                                                    | varies   |
| `docs`      | Public documentation site. The only Next.js app here.                       | 3002     |

**Libraries** (`packages/`). The ones you will actually touch are near the top:

| Package         | What it does                                                            |
| --------------- | ----------------------------------------------------------------------- |
| `react`         | The design system. **Check here before writing any UI.**                |
| `database`      | Generated types, migrations, edge functions, database clients.          |
| `auth`          | Login, sessions, `requirePermissions`, API keys, permission caching.    |
| `form`          | `ValidatedForm`, field components, zod helpers.                         |
| `jobs`          | Every Inngest background function, plus the workflow runtime.           |
| `lib`           | Shared server utilities: the Inngest client, `trigger()`, email, Slack. |
| `utils`         | Pure helpers: dates, money, arrays, strings, BOM maths.                 |
| `workflows`     | Customer workflow schema, validation and pure runtime. No I/O.          |
| `documents`     | PDF generation, email templates, barcode and label rendering.           |
| `locale`        | Lingui setup and language switching.                                    |
| `env`           | The one place `docs/platform/self-hosting/environment-variables` are read and validated. |
| `logger`        | Structured logging, with request-id correlation.                        |
| `notifications` | The notification event taxonomy (enums only).                           |
| `printing`      | Printer registry, label queue, physical print delivery.                 |
| `onboarding`    | New-company setup, the "Implementation Hub".                            |
| `kv`            | Redis client plus rate limiting.                                        |
| `stripe`        | Billing. Cloud edition only.                                            |
| `ee`            | Enterprise-only code: Xero, Slack, Jira, Linear, Onshape, plan gating.  |
| `viewer`        | 3D model and assembly-instruction rendering.                            |
| `tiptap`        | Rich text editor.                                                       |
| `dev`           | The `crbn` CLI that runs your local stack.                              |
| `checks`        | Repo conformance rules enforced in CI.                                  |
| `config`        | Shared tsconfig, Tailwind theme, vitest preset. No runtime code.        |
| `glossary`      | Canonical manufacturing term definitions used in field help.            |
| `harness`       | Internal AI-agent tooling. Not shipped.                                 |

**Inside an ERP module** (there are eighteen, under `apps/erp/app/modules/{module}/`):

```
purchasing/
├── purchasing.models.ts    zod schemas and the types derived from them
├── purchasing.service.ts   every database operation for this module
├── purchasing.server.ts    server-only helpers (optional)
├── types.ts                shared types
├── index.ts                barrel, import from "~/modules/purchasing"
└── ui/                     React components, grouped by feature
```

---

## Part 7: Where it all runs

The same code base runs in three shapes: on a laptop, on the cloud Carbon operates for
customers, and on a server a customer owns. Nothing in the application knows which one it
is in; the difference is entirely in configuration.

### 7.1 On a laptop

`pnpm dev` runs `crbn up`, a custom CLI that boots an eleven-container Docker stack, waits
for Postgres, applies migrations, regenerates the database types, seeds a test user, and
starts the apps. The apps themselves run as ordinary Node processes on the host, not in
containers, which is what makes hot reload fast.

Each Git worktree (a second checkout of the same repository) gets its own ports, its own
database and its own freshly minted keys, so several branches can run at once. Redis is
the one exception: a single shared container, with each worktree given its own numbered
slot inside it.

### 7.2 The cloud Carbon runs

The ERP and MES are packaged as Docker images and run on ECS Fargate [[3]](#g3), which is
Amazon running your container for you without any server to look after. Each service sits
behind its own load balancer on port 3000, is checked for life at `/health`, and scales
between one and ten copies on processor and memory pressure. All of that is described in
`sst.config.ts` (SST [[23]](#g23) is infrastructure-as-code, where you write cloud
resources in TypeScript instead of clicking in a console). The
`docs/platform/self-hosting/aws-sst` recipe is the same stack, run by you.

The part that surprises people: **this is not one big shared installation.** There is a
`workspaces` table, and on every deploy `ci/src/deploy.ts` walks it and runs
`sst deploy --stage prod` once per row, each with that customer's own AWS account, region,
domain, certificates, Supabase project and Redis. So Carbon separates customers twice
over: by `companyId` on every row inside one installation ([Part 3](#part-3-layer-by-layer)), and by giving a
customer their own installation entirely. Adding a customer means adding a workspace row.
A row missing a required field is skipped with a log line rather than failing the deploy,
so a tenant can silently not deploy.

Postgres is managed Supabase. There is nothing on Vercel despite some leftover Vercel
packages. There is one Lambda: the Assembler ships as a single image that runs either as a
Lambda function behind an API gateway (the default) or as a container, which is why 3D
conversion can be turned on per customer without changing the main stack.

### 7.3 On a customer's own server

`contrib/deploying/simple-docker-caddy/` holds a complete `docs/platform/self-hosting/docker-caddy`: a Docker
Swarm file that brings up Postgres, the Supabase services, Redis, Inngest and both apps on
one machine, with Caddy in front as the only thing exposed to the internet. Secrets are
Swarm secrets rather than environment variables in a file. Migrations run as a throwaway
one-shot container before the apps roll. `scripts/backup.sh` takes a database dump plus
the uploaded files (see `docs/platform/backups`), and `scripts/harden.sh` does the
basic firewall setup.

Which features exist is decided by one variable, `CARBON_EDITION`: `community`,
`cloud`, `enterprise` or `test`. What each of those buys you is the
`docs/platform/licensing`. Self-hosting defaults to `community`; the cloud fan-out
sets `enterprise`.

### 7.4 How a merge becomes production

Four GitHub Actions workflows, and they are deliberately independent of each other rather
than one pipeline:

| Workflow | Fires when | What it does |
| --- | --- | --- |
| `check.yml` | every pull request | Biome, typecheck, tests, translation and workflow-catalog checks |
| `deploy.yml` | merge to `main` touching `apps/erp`, `apps/mes` or `packages` | builds both images from the one root `Dockerfile`, pushes them to Amazon's image registry tagged with the commit, then fans out `sst deploy` per workspace |
| `supabase.yml` | merge touching `packages/database/supabase` | applies migrations and deploys edge functions, per workspace |
| `inngest.yml` | after `deploy.yml` succeeds | calls `PUT /api/inngest` on each app so Inngest learns the current list of jobs |

Two consequences worth knowing. First, `check.yml` never builds the apps, so a pull
request can go green and still break the image build on merge. Second, migrations and app
code deploy in parallel with no ordering between them, so a migration and the code that
depends on it can land seconds apart in either order; write migrations that are safe
against the previous version of the code.

There is no version tagging and no rollback button. An image is identified by its commit,
so rolling back means redeploying an older commit. Configuration is not held in a secrets
manager: values are read from the `workspaces` table at deploy time and set as plain
environment variables on the container.

### 7.5 Knowing what is happening

Observability is deliberately thin. Logs go through LogTape: colour on a laptop, one JSON
line per entry in production, with sensitive field names blanked out and a request id
threaded through everything so one page load can be followed end to end. There is no log
shipping of its own, so logs are whatever the platform collects: CloudWatch on AWS,
`docker service logs` when self-hosted. PostHog covers product analytics and is switched
off entirely in controlled (ITAR) environments. There is no Sentry and no distributed
tracing.

---

## Part 8: There's a bug, where do I look?

Start from what the user saw and walk inwards. This mirrors the order things happen.

**A few specific traps, each of which has caught someone out:**

- _TypeScript says a column doesn't exist._ Run `pnpm run generate:types`. Your generated
  types are behind your migrations.
- _A query returns nothing but the row is definitely there._ RLS. Either the `companyId`
  is wrong or you are using a user-scoped client where you needed service role.
- _A write half-succeeded._ Chained `supabase-js` calls are not a transaction. Look for a
  manual rollback that didn't cover the failure.
- _You see another company's data._ Something is using `bypassRls: true` or the
  service-role client without re-checking the tenant. **Treat this as urgent.**
- _A number on a list screen is wrong._ It is almost certainly computed in a view.

---

## Part 9: House rules

The full list is in `AGENTS.md` at the repo root. The ones that cause
the most damage when broken:

- **`pnpm`, never `npm`.**
- **Never use JavaScript `Date`** for parsing, formatting or arithmetic. Use
  `@internationalized/date` and `@carbon/utils`. A build check enforces this. Timezones in
  a manufacturing schedule are not cosmetic.
- **Never hand-edit the generated database types.** Regenerate them.
- **Never skip `companyId` scoping**, even though RLS would probably catch it.
- **Never chain `supabase-js` writes and call it a transaction.** Use Kysely, or an RPC.
- **Never query inside a loop.** Collect the ids and make one `.in()` call.
- **One `{module}.service.ts` and one `{module}.models.ts` per module.** Don't scatter them.
- **Run `pnpm run generate:types` after any migration, before typechecking.**

Useful commands:

```bash
pnpm dev                                        # boot everything
pnpm db:migrate:new <name>                      # create a migration
pnpm db:migrate                                 # apply migrations
pnpm run generate:types                         # regenerate database types
pnpm exec turbo run typecheck --filter=erp      # typecheck one package
pnpm run lint                                   # Biome
pnpm run test                                   # unit tests
```

Typechecking the whole repo at once runs out of memory, so always use `--filter`.

---

## Glossary

Numbered so the body can point at them. Alphabetical.

<a id="g1"></a>
**1. Action:** the function a route file exports to handle a form submission. Runs on the
server only, never shipped to the browser.

<a id="g2"></a>
**2. Deno:** an alternative JavaScript runtime to Node.js. Our edge functions are written
for it, which is why they use `https://` imports instead of `node_modules`.

<a id="g3"></a>
**3. ECS Fargate:** Amazon's service for running Docker containers without managing the
servers underneath. The ERP and MES run here in production.

<a id="g4"></a>
**4. Edge function:** a small server-side program deployed next to the database, called
over HTTP and awaited like a normal function. Ours are written for Deno.

<a id="g5"></a>
**5. Inngest:** the background job runner. Send it an event; it calls your function over
HTTP and remembers each completed step, so a retry resumes rather than restarts.

<a id="g6"></a>
**6. Kysely:** a TypeScript SQL query builder. Unlike `supabase-js` it holds a real
database connection, so it can run real transactions. It also bypasses RLS.

<a id="g7"></a>
**7. Lingui:** the translation library. You mark strings in code; it extracts them into
per-language files for translators.

<a id="g8"></a>
**8. Loader:** the function a route file exports to fetch the data its page needs. Runs
on the server only.

<a id="g9"></a>
**9. Migration:** one timestamped SQL file describing a schema change. The full ordered
set of them _is_ the schema; there is no separate schema file.

<a id="g10"></a>
**10. Monorepo:** one Git repository holding several applications and shared libraries
that are versioned and released together.

<a id="g11"></a>
**11. MRP:** Material Requirements Planning. Works out what to buy and make, and when,
given demand and current stock. Runs as an edge function.

<a id="g12"></a>
**12. Multi-tenancy:** one database and one running application serving many separate
customer companies, with each company's data invisible to the others.

<a id="g13"></a>
**13. nanostores:** a very small state library. We use it for reference lists (items,
customers, suppliers) that many screens read and Realtime keeps fresh.

<a id="g14"></a>
**14. pg_cron:** a Postgres extension that runs SQL on a schedule, inside the database.
Used for cache refreshes and queue sweeping.

<a id="g15"></a>
**15. pg_net:** a Postgres extension that lets the database make outbound HTTP calls. We
use it for exactly one thing: pinging the event queue awake after a commit.

<a id="g16"></a>
**16. PGMQ:** a message queue implemented in ordinary Postgres tables. Lets a database
trigger enqueue work inside the same transaction as the write that caused it.

<a id="g17"></a>
**17. Postgres:** the relational database everything in Carbon is built on. Version 15.

<a id="g18"></a>
**18. PostgREST:** a service that exposes Postgres tables and views as a REST API. Every
`client.from(...).select(...)` is a PostgREST call, not raw SQL.

<a id="g19"></a>
**19. Radix UI:** an unstyled, accessible React component library. Our design system adds
Tailwind styling on top of it.

<a id="g20"></a>
**20. RLS (Row Level Security):** a Postgres feature where a per-table rule is
automatically added to every query. It is what keeps one company's data invisible to
another.

<a id="g21"></a>
**21. RPC:** here, calling a function defined inside Postgres from application code, via
`client.rpc("name", args)`.

<a id="g22"></a>
**22. Service role:** a database credential that bypasses all RLS. Powerful; use
carefully.

<a id="g23"></a>
**23. SST:** infrastructure-as-code for AWS, written in TypeScript. `sst.config.ts`
defines our production cluster.

<a id="g24"></a>
**24. Supabase:** an open-source bundle around Postgres: REST API, auth, storage,
realtime and edge functions. We run its containers locally and use the managed version in
production.

<a id="g25"></a>
**25. Turborepo:** the build orchestrator that knows which packages depend on which, so
`pnpm build` only rebuilds what changed.

<a id="g26"></a>
**26. View:** a saved query that behaves like a read-only table. Carbon writes to tables
and reads from views; computed values like order totals live in the view.

<a id="g27"></a>
**27. Vite:** the build tool and dev server behind all our React apps.

<a id="g28"></a>
**28. zod:** a schema library. Describe data once, get validation and a TypeScript type
from the same definition.

<a id="g29"></a>
**29. zustand:** a small React state library. We use it only for throwaway UI state, like
whether a modal is open.

---

## Related

  - Self-hosting Run the apps on your own infrastructure: Docker on a VPS, or AWS with SST.
  - Environment variables The full configuration surface.
  - Licensing What Community, Enterprise and Cloud each include.
  - Backups Dumping the database and the uploaded files.
