# Plan 001: Tenant-scope the MES picking service-role write paths

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `llm/plans/improve/README.md` — unless a reviewer dispatched you and told
> you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 4ff79e2ed..HEAD -- apps/mes/app/services/picking.service.ts apps/mes/app/routes/x+/picking.\$pickingListId.line.quantity.tsx apps/mes/app/routes/x+/picking.\$pickingListId.status.tsx apps/mes/app/routes/x+/picking.\$pickingListId.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `4ff79e2ed`, 2026-06-13

## Why this matters

Two MES picking action routes mutate picking data using a **service-role**
Supabase client (`getCarbonServiceRole()`), which **bypasses Row-Level
Security**. They look the record up by an id taken straight from the request
body/params and never check that the record belongs to the authenticated
user's company. A user authenticated in company A can therefore POST a
`pickingListLineId` or `pickingListId` belonging to company B and mutate it —
changing pick quantities/status and, for the line-quantity path, triggering an
`issue` inventory posting against **company B's** inventory and ledger. This is
a cross-tenant write (IDOR). The authenticated user's `companyId` is already
available from `requirePermissions(...)`, so the fix is small and contained:
pass `companyId` into the two service functions and scope every read/write to
it.

## Current state

Files involved:

- `apps/mes/app/services/picking.service.ts` — MES picking service. Contains
  `setPickingListLineQuantity` (line 104) and `updatePickingListStatus`
  (line 62). Neither takes or enforces a `companyId`.
- `apps/mes/app/routes/x+/picking.$pickingListId.line.quantity.tsx` — action
  that calls `setPickingListLineQuantity` with a service-role client.
- `apps/mes/app/routes/x+/picking.$pickingListId.status.tsx` — action that
  calls `updatePickingListStatus` with a service-role client.
- `apps/mes/app/routes/x+/picking.$pickingListId.tsx` — loader that **also**
  calls `updatePickingListStatus` (auto Draft→In Progress), but with an
  **RLS-enforced** client. This call must be updated to pass `companyId` once
  the signature changes.

Current `updatePickingListStatus` (`picking.service.ts:62-76`):

```ts
export async function updatePickingListStatus(
  client: SupabaseClient<Database>,
  pickingListId: string,
  status: Database["public"]["Enums"]["pickingListStatus"],
  updatedBy: string
) {
  return client
    .from("pickingList")
    .update({
      status,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", pickingListId);
}
```

Current head of `setPickingListLineQuantity` (`picking.service.ts:104-131`) —
note it already fetches `pickingList(companyId)` but never compares it:

```ts
export async function setPickingListLineQuantity(
  client: SupabaseClient<Database>,
  args: {
    pickingListLineId: string;
    quantity: number;
    markShort?: boolean;
    userId: string;
  }
) {
  const lineResult = await client
    .from("pickingListLine")
    .select(
      "*, jobMaterial:jobMaterial!pickingListLine_jobMaterialId_fkey(id, quantityIssued), pickingList(companyId)"
    )
    .eq("id", args.pickingListLineId)
    .single();

  if (lineResult.error || !lineResult.data) {
    return { data: null, error: lineResult.error ?? "Line not found" };
  }
  // ...
```

Current action `picking.$pickingListId.line.quantity.tsx:8-28`:

```ts
export async function action({ context, request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();
  const pickingListLineId = formData.get("pickingListLineId") as string;
  const quantity = Number(formData.get("quantity") ?? 0);
  const markShort = formData.get("markShort") === "true";

  if (!pickingListLineId) {
    return { success: false, message: "Missing pickingListLineId" };
  }

  const result = await setPickingListLineQuantity(serviceRole, {
    pickingListLineId,
    quantity,
    markShort,
    userId: effectiveUserId
  });
```

Current action `picking.$pickingListId.status.tsx:11-33`:

```ts
export async function action({ context, request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const serviceRole = getCarbonServiceRole();
  // ...
  const result = await updatePickingListStatus(
    serviceRole,
    pickingListId,
    status as PickingListStatus,
    effectiveUserId
  );
```

Current loader call site `picking.$pickingListId.tsx:31-51`:

```ts
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const pickingListId = params.pickingListId!;
  // ...
  if (result.data.status === "Draft") {
    await updatePickingListStatus(
      client,
      pickingListId,
      "In Progress",
      effectiveUserId
    );
    result.data.status = "In Progress";
  }
```

### Relevant convention (quoted inline — the executor has not read it)

From `llm/conventions/database.md` (Kysely/transactions section): *"Kysely
bypasses RLS — enforce auth at route via `requirePermissions()`."* The same
principle applies to **any** RLS-bypassing client: a service-role Supabase
client (`getCarbonServiceRole()`) is not subject to RLS, so tenant isolation
must be enforced in code. `requirePermissions(request, {})` returns the
authenticated user's `companyId`; the empty permission map is the established
MES convention (the MES `userMiddleware` itself calls
`requirePermissions(request, {})`), so **do not** add module permissions here —
only thread `companyId` through.

Key fact: `pickingListLine` and `pickingList` both have a `companyId TEXT NOT
NULL` column, so `.eq("companyId", companyId)` is a valid scope on each.

## Commands you will need

| Purpose     | Command                                  | Expected on success    |
|-------------|------------------------------------------|------------------------|
| Install     | `pnpm install`                           | exit 0                 |
| Typecheck   | `turbo run typecheck --filter=mes`       | exit 0, no errors      |
| Lint        | `pnpm exec biome lint apps/mes/app/services/picking.service.ts apps/mes/app/routes/x+/` | no diagnostics on changed files |

NEVER run a whole-repo typecheck (`pnpm typecheck` / `--filter='*'`) — it OOMs
the machine. NEVER run any DB migrate/seed/build/reset command. This plan does
not touch the database schema.

If `--filter=mes` reports "no package found", open `apps/mes/package.json` and
use the exact `name` field as the filter value.

## Scope

**In scope** (the only files you should modify):
- `apps/mes/app/services/picking.service.ts`
- `apps/mes/app/routes/x+/picking.$pickingListId.line.quantity.tsx`
- `apps/mes/app/routes/x+/picking.$pickingListId.status.tsx`
- `apps/mes/app/routes/x+/picking.$pickingListId.tsx` (loader call site only)

**Out of scope** (do NOT touch):
- `getPickingListForExecution` and `getAssignedPickingLists` in the same
  service file — they run on RLS-enforced clients and are tenant-safe already.
- Generated types (`packages/database/src/types.ts`), Lingui `*.po`/`*.mjs`.
- The database itself / any migration.
- The `requirePermissions(request, {})` empty permission map — leave it empty
  (MES convention). Only add `companyId` to the destructure.

## Git workflow

- Branch: `improve/001-mes-picking-tenant-scope` (Carbon uses `feat/*`/`fix/*`;
  this is advisor-driven hardening).
- Conventional commit: `fix: scope MES picking writes to the caller's company`.
- Do NOT push, open a PR, or merge unless the operator instructs it.

## Steps

### Step 1: Make `updatePickingListStatus` company-scoped

In `apps/mes/app/services/picking.service.ts`, add a required `companyId`
parameter and scope the update by it:

```ts
export async function updatePickingListStatus(
  client: SupabaseClient<Database>,
  pickingListId: string,
  status: Database["public"]["Enums"]["pickingListStatus"],
  updatedBy: string,
  companyId: string
) {
  return client
    .from("pickingList")
    .update({
      status,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", pickingListId)
    .eq("companyId", companyId);
}
```

**Verify**: `turbo run typecheck --filter=mes` → fails with errors at the THREE
call sites (the two actions + the loader) because they now pass too few
arguments. That is expected; Steps 2–4 fix them.

### Step 2: Make `setPickingListLineQuantity` company-scoped

Add `companyId` to its `args` object and scope the initial line lookup by it.
Change the signature args and the first query:

```ts
export async function setPickingListLineQuantity(
  client: SupabaseClient<Database>,
  args: {
    pickingListLineId: string;
    quantity: number;
    markShort?: boolean;
    userId: string;
    companyId: string;
  }
) {
  const lineResult = await client
    .from("pickingListLine")
    .select(
      "*, jobMaterial:jobMaterial!pickingListLine_jobMaterialId_fkey(id, quantityIssued), pickingList(companyId)"
    )
    .eq("id", args.pickingListLineId)
    .eq("companyId", args.companyId)
    .single();
  // ...rest unchanged...
```

Leave the rest of the function body unchanged. The `.eq("companyId", ...)` on
`pickingListLine` means a line from another company returns no row, and the
existing guard `if (lineResult.error || !lineResult.data) return { ... "Line
not found" }` handles it cleanly.

**Verify**: `turbo run typecheck --filter=mes` → still errors only at the call
sites (now in `.line.quantity.tsx` too). Proceed.

### Step 3: Pass `companyId` from the line-quantity action

In `apps/mes/app/routes/x+/picking.$pickingListId.line.quantity.tsx`, destructure
`companyId` from `requirePermissions` and pass it through:

```ts
const { userId, companyId } = await requirePermissions(request, {});
```

and in the `setPickingListLineQuantity(serviceRole, { ... })` call, add
`companyId` to the args object:

```ts
const result = await setPickingListLineQuantity(serviceRole, {
  pickingListLineId,
  quantity,
  markShort,
  userId: effectiveUserId,
  companyId
});
```

**Verify**: `turbo run typecheck --filter=mes` → this file no longer errors.

### Step 4: Pass `companyId` from the status action and the loader

In `apps/mes/app/routes/x+/picking.$pickingListId.status.tsx`:

```ts
const { userId, companyId } = await requirePermissions(request, {});
```

and add `companyId` as the final argument to `updatePickingListStatus`:

```ts
const result = await updatePickingListStatus(
  serviceRole,
  pickingListId,
  status as PickingListStatus,
  effectiveUserId,
  companyId
);
```

In `apps/mes/app/routes/x+/picking.$pickingListId.tsx` (loader), destructure
`companyId` and pass it to the auto-transition call:

```ts
const { client, userId, companyId } = await requirePermissions(request, {});
// ...
await updatePickingListStatus(
  client,
  pickingListId,
  "In Progress",
  effectiveUserId,
  companyId
);
```

**Verify**: `turbo run typecheck --filter=mes` → exit 0, no errors.

### Step 5: Lint

**Verify**: `pnpm exec biome lint apps/mes/app/services/picking.service.ts apps/mes/app/routes/x+/picking.$pickingListId.line.quantity.tsx apps/mes/app/routes/x+/picking.$pickingListId.status.tsx apps/mes/app/routes/x+/picking.$pickingListId.tsx`
→ no diagnostics.

## Test plan

`apps/mes` has no vitest infrastructure (per `llm/tasks/lessons.md`), and these
are thin route/service glue functions over Supabase — adding a unit-test harness
here is out of proportion to the change. **No new automated tests.** Verification
is via typecheck + lint + the manual check below.

Manual verification (the operator runs this against the local dev server; the
executor does NOT need to): as a user in company A, attempt to POST a
`pickingListLineId` and a `pickingListId` that belong to company B to
`/x/picking/:id/line/quantity` and `/x/picking/:id/status`. Expected: the
service returns `{ success: false, message: "Line not found" }` (line path) or
a no-op update affecting 0 rows (status path) — never a cross-company mutation.

## Done criteria

ALL must hold:

- [ ] `turbo run typecheck --filter=mes` exits 0
- [ ] `pnpm exec biome lint` on the four in-scope files reports no diagnostics
- [ ] `updatePickingListStatus` and `setPickingListLineQuantity` both require a
      `companyId` and apply `.eq("companyId", ...)` to their `pickingList` /
      `pickingListLine` access
- [ ] All four call sites (two actions + loader auto-transition + service
      internals) compile with `companyId` threaded through
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `llm/plans/improve/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows any in-scope file changed and the "Current state"
  excerpts no longer match the live code.
- `requirePermissions` does **not** return a `companyId` field (it should — the
  MES middleware destructures `companyId` from it). If it doesn't, stop rather
  than guessing where to source `companyId`.
- Typecheck reveals a fifth caller of either function outside the in-scope files
  (grep `updatePickingListStatus\|setPickingListLineQuantity` across `apps/mes`).
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- A reviewer should confirm there is no other route that calls these two
  functions with a service-role client without passing the caller's `companyId`.
- The deeper architectural smell is that MES uses a service-role client for
  these writes at all (ERP's `generatePickingList` uses the RLS client). Why the
  service role is needed (likely the `issue` edge-function invocation) is worth
  documenting; switching to an RLS client would make the `.eq("companyId")`
  guards belt-and-suspenders rather than the sole defense. Deferred — out of
  scope here.
- After this lands and is committed, the `inventory-system` cache doc could note
  that MES picking writes are tenant-scoped in code because they bypass RLS. Do
  NOT update `llm/cache/` as part of this plan (cache is for committed code).
