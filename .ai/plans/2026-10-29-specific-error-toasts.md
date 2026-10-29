# Specific error toasts — implementation plan

**Spec / source:** `.ai/specs/2026-10-29-specific-error-toasts.md`
**Branch:** `feat/specific-error-toasts` (worktree `/Users/aashu/work/carbon/carbon-feat-specific-error-toasts`)

Run every command from the worktree root. Never commit: the user commits by hand after review.
Before each typecheck or test run, check free memory. Run one heavy command at a time.

## Progress
- [x] Task 1: Install dependencies
- [x] Task 2: Add `describeCause` and `reasonText` to `@carbon/utils`
- [x] Task 3: Add `requireAffected` to `@carbon/utils`
- [x] Task 4: Make `databaseRefusal` read the shared reason
- [x] Task 5: Carry `title` and `reason` on `CarbonError` and `toResult`
- [x] Task 6: Forward `title` and `reason` in `respond`
- [x] Task 7: Carry `reason` on the legacy `Result` and the flash cookie
- [x] Task 8: Add `<ErrorReason>` and `toastError` to `@carbon/react`
- [x] Task 9: Show the reason in the flash toast and in `useAction`
- [x] Task 10: Make the error-toast description readable
- [x] Task 11: Extract the new Lingui strings
- [x] Task 12: Sweep ERP modules, part 1
- [x] Task 13: Sweep ERP modules, part 2
- [x] Task 14: Sweep ERP item routes
- [x] Task 15: Sweep ERP settings and people routes
- [x] Task 16: Sweep ERP accounting routes
- [x] Task 17: Sweep ERP sales routes
- [x] Task 18: Sweep ERP purchasing routes
- [x] Task 19: Sweep ERP production and inventory routes
- [x] Task 20: Sweep ERP quality and remaining `x+` routes
- [x] Task 21: Sweep ERP `api+`, `_public+` and other route folders
- [x] Task 22: Sweep ERP components and hooks
- [x] Task 23: Sweep MES
- [x] Task 24: Update the rules and AGENTS.md files
- [ ] Task 25: Final verification — automated checks pass (2026-10-29); browser check left to the user

## Dependencies
- Tasks 2–11 run in order.
- Tasks 12–23 need Tasks 2–11. They do not depend on each other. Run them one at a time, because each runs the ERP or MES typecheck.
- Task 24 needs Tasks 2–10.
- Task 25 needs all other tasks.

---

## Sweep procedure (used by Tasks 12–23)

Each sweep task names its folders. In those folders, do these steps.

1. List the calls:
   ```bash
   rg -n -t ts -g '!*.test.*' '(^|[^.\w])error\(|toast\.error\(' <folders>
   ```
2. For each server `error(cause, title)` call:
   1. If `cause` is `params`, or another value that is not an error, replace it with the real error in scope. If no error is in scope, use `null`.
   2. If `cause` is `null` and an error is in scope (a Supabase `{ error }`, a `catch (err)`), pass that error.
   3. If `cause` is a string literal, replace it with `null` unless the string adds detail that the title does not have.
   4. If the title does not describe the operation (for example "Failed to update quote" on a delete), correct the title.
   5. Leave the call unchanged when the title already says what went wrong.
3. For each client `toast.error(...)` call:
   1. If it shows a fixed string and an error is in scope, change it to `toastError(title, error)`. Import `toastError` from `@carbon/react`.
   2. If it shows `fetcher.data.message` or `result.message` from a legacy `{ success: false, message }` result, change it to `toastError(data.message ?? title, data)`. `describeCause` reads the `reason` that the result carries.
   3. If it shows `data.error.message` from a service function result, change it to `toastServiceError(data)`. Import it from `@carbon/query`.
   4. If it already shows `error.message` with a fallback (`err.message || t\`…\``), change it to `toastError(t\`…\`, err)`.
4. For each single-record write keyed by id, wrap it with `requireAffected` (`@carbon/utils`):
   ```ts
   // before
   const result = await client.from("purchaseOrder").update(data).eq("id", id).eq("companyId", companyId);
   // after
   const result = await requireAffected(
     client.from("purchaseOrder").update(data).eq("id", id).eq("companyId", companyId).select("id")
   );
   ```
   - It applies to `.update(...)` and `.delete()` whose filter includes `.eq("id", …)` and no `.in(...)`.
   - If the call already ends with `.select(...)`, keep that select and wrap the call.
   - If the call ends with `.single()` or `.maybeSingle()`, do not wrap it. `.single()` already returns PGRST116 for 0 rows.
   - If a function returns the builder without `await`, wrap it in the function: `return requireAffected(builder.select("id"))`. Then check each caller with `rg -n '<functionName>\('`. If a caller chains more builder methods on the result, do not wrap that function.
   - Do not wrap a write that is a known no-op on purpose. Examples: "clear a flag if set", cleanup after a delete, writes inside a `for` loop over a list.
5. Run Biome on the changed files:
   ```bash
   pnpm exec biome check --write $(git diff --name-only -- <folders>)
   # Expected: "Checked N files" and no errors
   ```
6. Run the task's typecheck command.
7. Append one line per changed file to `.ai/runs/2026-10-29-specific-error-toasts-sweep-task-<N>.md` (one file per task, so parallel tasks never write one file): the path, the number of `error()` fixes, `toast` changes and `requireAffected` wraps.

If a call does not fit any rule above, leave it unchanged. Then add it to the run log with the reason. Do not improvise.

---

## Task 1: Install dependencies

**Depends on:** none
**Files:** none

**Steps:**
1. Check free memory: `vm_stat | awk '/Pages free|Pages inactive/ {gsub("\\.","",$3); s+=$3} END {print s*16384/1e9 " GB"}'`.
2. Run `pnpm install`.

**Verify:**
```bash
ls node_modules/@carbon/utils node_modules/.bin/vitest
# Expected: both paths print, no "No such file"
```

**Out of scope:** `crbn up`. The database is not needed until Task 25.

---

## Task 2: Add `describeCause` and `reasonText` to `@carbon/utils`

**Depends on:** 1
**Files:**
- Create: `packages/utils/src/error-reason.ts`
- Create: `packages/utils/src/error-reason.test.ts`
- Modify: `packages/utils/src/index.ts` — add `export * from "./error-reason";` next to `export * from "./errors";`
- Copy from (precedent): `packages/api/src/database-refusal.ts` (parsing), `packages/api/src/errors.ts:123-133` (`summarizeIssues`)

**Steps:**
1. Run `pnpm --filter @carbon/checks license-headers` after you create each new file.
2. Write `packages/utils/src/error-reason.ts` with this content:
   ```ts
   // Why a write failed, as data: a code and the names it needs. The server
   // reads it from the error; the browser renders it, translated, as the
   // toast's second line. `raw` carries text that cannot be translated (a
   // trigger's RAISE, an exception's message).

   export type FailureReasonCode =
     | "duplicate" | "stillUsed" | "noMatch" | "required" | "breaksRule"
     | "badValue" | "forbidden" | "notFound" | "notApplied" | "raw";

   export type FailureReason = {
     code: FailureReasonCode;
     values: Record<string, string>;
   };

   /** The code `requireAffected` gives a write that changed no row. */
   export const NOT_APPLIED_CODE = "CARBON_NOT_APPLIED";
   export const NOT_APPLIED_TEXT =
     "You don't have permission to change this record, or it no longer exists.";

   const RAW_TEXT_LIMIT = 300;
   const RAISE_CODES = new Set(["P0001", "55000"]);
   const AUTHORABLE_CODES = new Set(["23514", "23503", "42501"]);
   const POSTGRES_WORDING = /violates|permission denied/i;

   type Fields = {
     code: string; message: string; details: string;
     column?: string; table?: string; constraint?: string;
   };
   ```
3. Move `fieldsOf`, `IDENTITY_COLUMNS`, `keyColumns`, `quoted`, `list` and `capitalize` from `packages/api/src/database-refusal.ts` into this file unchanged. Rename `fieldsOf` to `databaseFields` and export it.
4. Add `databaseReason(error: unknown): FailureReason | null`. It loops over `[error, (error as { cause?: unknown })?.cause]` as `databaseRefusal` does. It maps the code with this table:

   | SQLSTATE | Reason |
   |---|---|
   | 23505 | `duplicate`, `values.columns = list(keyColumns(details))` when there is at least 1 column |
   | 23503 with `still referenced from table "x"` | `stillUsed`, `values.table = x` |
   | 23503 otherwise | `noMatch`, `values.columns` when there are columns, `values.target` when `not present in table "x"` matches |
   | 23502 | `required`, `values.column = f.column ?? quoted(/column "([^"]+)"/, f.message)` when found |
   | 23514 | `breaksRule`, `values.constraint = f.constraint ?? quoted(/check constraint "([^"]+)"/, f.message)` when found |
   | 22P02, 22001, 22003, 22007, 22008 | `badValue`, `values.text = capitalize(f.message)` when `f.message` is not empty |
   | 42501 | `forbidden`, no values |
   | PGRST116 | `notFound`, no values |

5. Add `reasonText(reason: FailureReason): string`. It gives exactly the current `databaseRefusal` English:

   | Code | Text |
   |---|---|
   | `duplicate` | `` `A record with this ${columns} already exists.` `` or `"A record with these values already exists."` |
   | `stillUsed` | `` `It is still used by a "${table}" record; remove that first.` `` |
   | `noMatch` | `` `${columns} does not match an existing "${target}".` ``, else `` `${columns} does not match an existing record.` ``, else `"A referenced record does not exist."` |
   | `required` | `` `"${column}" is required.` `` or `"A required field was missing."` |
   | `breaksRule` | `` `The values break the rule "${constraint}".` `` or `"The values break a rule on this record."` |
   | `badValue` | `` `${text}.` `` or `"A value is not valid."` |
   | `forbidden` | `"You do not have permission to do this"` |
   | `notFound` | `"No matching record was found."` |
   | `notApplied` | `NOT_APPLIED_TEXT` |
   | `raw` | `values.text` |

6. Add a private `raw(text: string): FailureReason`. If `text` is longer than `RAW_TEXT_LIMIT`, cut it to 299 characters and add `…`.
7. Add a private `summarizeZodIssues`, copied from `summarizeIssues` in `packages/api/src/errors.ts:123-133`, with its `isZodError` check.
8. Add `describeCause(cause: unknown): FailureReason | null` in this order:
   1. `cause` is `null` or `undefined` → `null`.
   2. `cause` is a string → `raw(cause)` when not empty, else `null`.
   3. `cause` is not an object → `null`.
   4. `cause.reason` is an object with a string `code` and an object `values` → return `cause.reason`. This reads a legacy `Result` or a serialized service error.
   5. `cause.code === NOT_APPLIED_CODE` → `{ code: "notApplied", values: {} }`.
   6. `databaseFields(cause)` (or of `cause.cause`) has a code in `RAISE_CODES` and a message → `raw(message)`.
   7. It has a code in `AUTHORABLE_CODES`, a message, and the message does not match `POSTGRES_WORDING` → `raw(message)`.
   8. `databaseReason(cause)` is not `null` → return it.
   9. A zod error → `raw(summarizeZodIssues(cause))`.
   10. `cause.message` is a non-empty string and (`cause instanceof Error` or `typeof cause.code === "string"`) → `raw(cause.message)`.
   11. Else `null`. This covers `params` and other plain objects.
9. Write `packages/utils/src/error-reason.test.ts` (vitest). Copy the cases of `packages/api/src/database-refusal.test.ts` and assert `reasonText(databaseReason(x)!)` equals the message that file expects. Add one test for each step of `describeCause`, including:
   - `{ code: "P0001", message: "Accounting period is closed for posting date 2026-10-01" }` → `raw` with that text.
   - `{ code: "23514", message: "Quantity must be positive" }` → `raw`.
   - `{ code: "23514", message: 'new row for relation "x" violates check constraint "x_qty_check"', constraint: "x_qty_check" }` → `breaksRule`.
   - `{ orderId: "PO-1" }` → `null`.
   - A 400-character string → text of 300 characters ending with `…`.
   - `{ success: false, message: "x", reason: { code: "duplicate", values: {} } }` → that reason.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- error-reason
# Expected: all tests pass, 0 failed
pnpm exec turbo run typecheck --filter=@carbon/utils
# Expected: "Tasks: 1 successful" (or more, all successful)
```

**Out of scope:** `getErrorMessage` and `getDatabaseErrorMessage` in `packages/utils/src/errors.ts`. Leave them unchanged.

---

## Task 3: Add `requireAffected` to `@carbon/utils`

**Depends on:** 2
**Files:**
- Create: `packages/utils/src/require-affected.ts`
- Create: `packages/utils/src/require-affected.test.ts`
- Modify: `packages/utils/src/index.ts` — add `export * from "./require-affected";`

**Steps:**
1. Write the function:
   ```ts
   import { NOT_APPLIED_CODE, NOT_APPLIED_TEXT } from "./error-reason";

   /**
    * A single-record write that changed no row: RLS skipped it or the record
    * is gone, and Postgres reports neither as an error. Give the write
    * `.select("id")` so the changed rows come back, and wrap it.
    */
   export async function requireAffected<
     R extends { error: unknown; data: unknown }
   >(query: PromiseLike<R>): Promise<R> {
     const result = await query;
     if (result.error == null && Array.isArray(result.data) && result.data.length === 0) {
       return {
         ...result,
         error: { name: "PostgrestError", code: NOT_APPLIED_CODE, message: NOT_APPLIED_TEXT, details: "", hint: "" }
       } as R;
     }
     return result;
   }
   ```
2. Write 3 tests: 0 rows gives the error; 1 row passes through; an existing error passes through unchanged.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- require-affected
# Expected: 3 passed
```

**Out of scope:** Using it at any call site. Tasks 12–23 do that.

---

## Task 4: Make `databaseRefusal` read the shared reason

**Depends on:** 2
**Files:**
- Modify: `packages/api/src/database-refusal.ts` — replace the parsing with `@carbon/utils`

**Steps:**
1. Replace the file body with:
   ```ts
   import { databaseReason, type FailureReason, type FailureReasonCode, reasonText } from "@carbon/utils";
   import type { ErrorCategory } from "./service-fn.server";

   export type DatabaseRefusal = { category: ErrorCategory; message: string; reason: FailureReason };

   const CATEGORIES: Partial<Record<FailureReasonCode, ErrorCategory>> = {
     duplicate: "conflict", stillUsed: "conflict", noMatch: "conflict",
     required: "validation", breaksRule: "validation", badValue: "validation",
     forbidden: "forbidden", notFound: "notFound"
   };

   export function databaseRefusal(error: unknown): DatabaseRefusal | null {
     const reason = databaseReason(error);
     const category = reason && CATEGORIES[reason.code];
     return reason && category ? { category, message: reasonText(reason), reason } : null;
   }
   ```
2. Keep the file's license header and its leading comment block.
3. If `packages/api/src/database-refusal.test.ts` asserts with `toEqual` on the whole object, add `reason: expect.any(Object)` to those assertions. Do not change any expected `message` or `category`.

**Verify:**
```bash
pnpm --filter @carbon/api test -- database-refusal service-tools
# Expected: all tests pass
```

**Out of scope:** `serviceRefusal` in `service-tools.server.ts`. Its P0001 branch stays.

If a `message` assertion fails, STOP and report. The English text must not change (spec D6).

---

## Task 5: Carry `title` and `reason` on `CarbonError` and `toResult`

**Depends on:** 4
**Files:**
- Modify: `packages/api/src/service-fn.server.ts` — `CarbonError`, `refusalFromDatabase`, the `call` function in `defineServiceFn`, `SerializedError`, `toResult`
- Modify: `packages/api/src/service-fn.server.test.ts` — new tests

**Steps:**
1. Add an optional 4th constructor argument to `CarbonError`: `detail?: { title?: string; reason?: FailureReason }`. Store it as `readonly title?: string` and `readonly reason?: FailureReason`.
2. In `refusalFromDatabase`, when `message` is set, pass `{ title: <message without its trailing "." or ":">, reason: known.reason }`. When `message` is undefined, pass no detail.
3. In `call`, the `out.category === "internal"` branch: if `refused` is null and `out.reason` is undefined, return `failed(new CarbonError("internal", out.message, out.cause, { title: out.message, reason: describeCause(out.cause) ?? undefined }))`.
4. In the `catch (err)` branch: when `refused` is null, use `new CarbonError("internal", "Something went wrong", err, { title: "Something went wrong", reason: describeCause(err) ?? undefined })`.
5. Add `title?: string; reason?: FailureReason` to `SerializedError`.
6. In `toResult`, add `title` and `reason` to the error object only when they are set. Keep `category`, `message` and `status` as they are.
7. Add tests:
   1. A service function that returns `ctx.error("internal", "Failed to update the purchase order", { code: "23505", details: "Key (readableId)=(PO-1) already exists." })` gives `message` `'Failed to update the purchase order: A record with this "readableId" already exists.'` (unchanged), `title` `"Failed to update the purchase order"` and `reason.code` `"duplicate"`.
   2. The same with `{ code: "P0001", message: "Accounting period is closed" }` gives category `internal`, `message` `"Failed to update the purchase order"`, and `reason` `raw` with that text.
   3. A `run` that throws `new Error("boom")` gives `reason` `raw` `"boom"`.
   4. `toResult` of an error with no reason has exactly the keys `category`, `message`, `status`.

**Verify:**
```bash
pnpm --filter @carbon/api test
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/api
# Expected: all tasks successful
```

**Out of scope:** Non-internal categories. A `rule` or `validation` refusal keeps its message and gets no reason.

---

## Task 6: Forward `title` and `reason` in `respond`

**Depends on:** 5
**Files:**
- Modify: `packages/api/src/carbon.server.ts:113-132`

**Steps:**
1. Change the `result` parameter type to `{ error: { message: string; title?: string; reason?: FailureReason } | null }`.
2. Replace `await flash(request, error(null, result.error.message))` with:
   ```ts
   await flash(request, {
     ...error(null, result.error.title ?? result.error.message),
     ...(result.error.reason && { reason: result.error.reason })
   })
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/api
# Expected: all tasks successful
```

**Out of scope:** The success branch of `respond`.

---

## Task 7: Carry `reason` on the legacy `Result` and the flash cookie

**Depends on:** 2
**Files:**
- Modify: `packages/auth/src/types.ts:64-70` — add `reason?: FailureReason;` with a comment "Why it failed, rendered as the toast's second line."
- Modify: `packages/auth/src/utils/result.ts:10-23`
- Modify: `packages/auth/src/services/session.server.ts:297-319` (`flash`) and `:341-360` (`getSessionFlash`)

**Steps:**
1. In `error()`, after the log, compute `const reason = describeCause(error);`. Return `{ success: false, message, ...(reason && { reason }) }`.
2. In `flash()`, after the `description` line, add `if (result.reason) session.flash("reason", result.reason);`.
3. In `getSessionFlash()`, add `reason: session.get("reason") as FailureReason | undefined` to the result object.

**Verify:**
```bash
pnpm --filter @carbon/auth test
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/auth
# Expected: all tasks successful
```

**Out of scope:** `success()`. It gets no reason.

If `createCookieSessionStorage` rejects an object value in `session.flash`, store `JSON.stringify(result.reason)` and parse it in `getSessionFlash` inside a `try`. Do not drop the reason.

---

## Task 8: Add `<ErrorReason>` and `toastError` to `@carbon/react`

**Depends on:** 2
**Files:**
- Create: `packages/react/src/ErrorReason.tsx`
- Modify: `packages/react/src/index.tsx` — export `ErrorReason`, `errorDescription` and `toastError`
- Copy from (precedent): a `packages/react/src` file that already uses `useLingui` from `@lingui/react/macro` (for example `packages/react/src/BottomSheet.tsx`)

**Steps:**
1. Write a function-declaration hook `useReasonText(reason: FailureReason): string`. It calls `const { t } = useLingui();`. It destructures `const { columns, table, target, column, constraint, text } = reason.values;`. It has one `switch (reason.code)` case per code, with the English of Task 2 step 5 inside `t\`…\``. `raw` returns `text ?? ""`. The `default` branch assigns `reason.code` to a `never` variable.
2. Write `export function ErrorReason({ reason }: { reason: FailureReason }) { return <>{useReasonText(reason)}</>; }`.
3. Write `export function errorDescription(title: string, reason: FailureReason | null | undefined)`. It returns `undefined` when `reason` is empty, or when `reason.code === "raw"` and `reason.values.text === title`. Else it returns `<ErrorReason reason={reason} />`.
4. Write `export function toastError(title: string, cause?: unknown)`. It returns `toast.error(title, { description: errorDescription(title, describeCause(cause)) })`.
5. Run `pnpm --filter @carbon/checks license-headers`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/react
# Expected: all tasks successful
```

**Out of scope:** Any change to `Toast.tsx`. Task 10 does that.

---

## Task 9: Show the reason in the flash toast and in `useAction`

**Depends on:** 5, 7, 8
**Files:**
- Modify: `packages/auth/src/middleware/flash.client.ts:14-31`
- Modify: `packages/query/src/action-outcome.ts` — add `serviceError(data)`
- Modify: `packages/query/src/useAction.ts:66-69`
- Modify: `packages/query/src/index.ts` — export `toastServiceError`
- Modify: `packages/query/src/action-outcome.test.ts`

**Steps:**
1. In `flash.client.ts`, change the error branch to:
   ```ts
   toast.error(result.message, {
     description: result.description ?? errorDescription(result.message, result.reason)
   });
   ```
   Import `errorDescription` from `@carbon/react`.
2. In `action-outcome.ts`, add `serviceError(data: unknown): { title: string; reason?: FailureReason } | null`. It returns `null` where `serviceErrorMessage` returns `null`. Else `title` is `error.title ?? error.message`, and `reason` is `error.reason` when it is an object.
3. Add `toastServiceError(data: unknown): void` in a new `packages/query/src/toastServiceError.ts`. It reads `serviceError(data)`. If set, it calls `toast.error(title, { description: errorDescription(title, reason) })`.
4. In `useAction.ts`, replace the two lines `const message = serviceErrorMessage(data); if (message) toast.error(message);` with `toastServiceError(data);`.
5. Add tests to `action-outcome.test.ts` for `serviceError`: with `title` and `reason`, with only `message`, and with a legacy `{ success: false }` shape (gives `null`).

**Verify:**
```bash
pnpm --filter @carbon/query test
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/query --filter=@carbon/auth
# Expected: all tasks successful
```

**Out of scope:** `serviceErrorMessage`. Keep it exported and unchanged.

---

## Task 10: Make the error-toast description readable

**Depends on:** 9
**Files:**
- Modify: `packages/react/src/Toast.tsx:28-29` — the `error` class

**Steps:**
1. Find the attribute sonner puts on the description element: `rg -n "data-description" node_modules/sonner/dist/index.mjs`.
2. If it is `data-description`, append `group-[.toaster]:[&_[data-description]]:!text-white/85` to the `error` class string.
3. Do the same for the `success` class.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/react
# Expected: all tasks successful
```

**Out of scope:** The toast layout, position or close button.

If sonner uses no `data-description` attribute, STOP and report the attribute or class it uses.

---

## Task 11: Extract the new Lingui strings

**Depends on:** 8
**Files:**
- Modify: `packages/locale/locales/*/erp.po`, `packages/locale/locales/*/mes.po` (generated)

**Steps:**
1. Run `pnpm lingui:extract`.
2. Run `pnpm lingui:clean`.

**Verify:**
```bash
rg -c 'already exists\.|no longer exists\.' packages/locale/locales/en/erp.po packages/locale/locales/en/mes.po
# Expected: a count of at least 2 in each file
git diff --stat -- packages/locale/locales | tail -1
# Expected: insertions; deletions only from header lines that lingui:clean strips
```

**Out of scope:** `pnpm translate`. The user runs the LLM translation step.

---

## Task 12: Sweep ERP modules, part 1

**Depends on:** 2–11
**Folders:** `apps/erp/app/modules/sales`, `purchasing`, `invoicing`, `accounting`, `inventory`, `documents`, `shared`, without their `ui/` folders (Task 22 owns those)

**Steps:** Do the sweep procedure on these folders.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
pnpm --filter erp test -- modules/sales modules/purchasing modules/inventory
# Expected: no new failures compared with a run before the task
```

**Out of scope:** Business logic. Change only error causes, titles, toasts and `requireAffected` wraps.

---

## Task 13: Sweep ERP modules, part 2

**Depends on:** 2–11
**Folders:** `apps/erp/app/modules/production`, `quality`, `items`, `resources`, `settings`, `people`, `users`, `workflows`, `agent`, without their `ui/` folders (Task 22 owns those)

**Steps:** Do the sweep procedure on these folders.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** Business logic.

---

## Task 14: Sweep ERP item routes

**Depends on:** 2–11
**Folders:** `apps/erp/app/routes/x+/items+`, `part+`, `material+`, `consumable+`, `tool+`, `service+`

**Steps:** Do the sweep procedure on these folders. Also fix `apps/erp/app/routes/x+/items+/uom.delete.$uomId.tsx:77` (`error(params, …)`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** Route behavior other than error reporting.

---

## Task 15: Sweep ERP settings and people routes

**Depends on:** 2–11
**Folders:** `apps/erp/app/routes/x+/settings+`, `users+`, `people+`, `person+`, `resources+`, `training+`

**Steps:** Do the sweep procedure on these folders.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** Route behavior other than error reporting.

---

## Task 16: Sweep ERP accounting routes

**Depends on:** 2–11
**Folders:** `apps/erp/app/routes/x+/accounting+`, `payments+`, `credits+`, `reimbursements+`, `fixed-asset+`, `lease+`, `reports+`

**Steps:** Do the sweep procedure on these folders.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** Route behavior other than error reporting.

---

## Task 17: Sweep ERP sales routes

**Depends on:** 2–11
**Folders:** `apps/erp/app/routes/x+/sales+`, `quote+`, `sales-order+`, `sales-rfq+`, `sales-invoice+`, `sales-return-order+`, `customer+`, `contract+`, `rental-agreement+`

**Steps:** Do the sweep procedure on these folders.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** Route behavior other than error reporting.

---

## Task 18: Sweep ERP purchasing routes

**Depends on:** 2–11
**Folders:** `apps/erp/app/routes/x+/purchasing+`, `purchase-order+`, `purchase-invoice+`, `purchase-return-order+`, `purchasing-rfq+`, `supplier+`, `supplier-quote+`

**Steps:** Do the sweep procedure on these folders.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** Route behavior other than error reporting.

---

## Task 19: Sweep ERP production and inventory routes

**Depends on:** 2–11
**Folders:** `apps/erp/app/routes/x+/job+`, `production+`, `assembly+`, `procedure+`, `scheduling+`, `priority+`, `picking-list+`, `maintenance+`, `inventory+`

**Steps:** Do the sweep procedure on these folders.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** Route behavior other than error reporting.

---

## Task 20: Sweep ERP quality and remaining `x+` routes

**Depends on:** 2–11
**Folders:** every folder in `apps/erp/app/routes/x+/` that Tasks 14–19 do not name. List them with:
```bash
ls -d apps/erp/app/routes/x+/*/
```

**Steps:** Do the sweep procedure on these folders, and on the files directly in `apps/erp/app/routes/x+/`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** Route behavior other than error reporting.

---

## Task 21: Sweep ERP `api+`, `_public+` and other route folders

**Depends on:** 2–11
**Folders:** every folder in `apps/erp/app/routes/` except `x+` (`api+`, `_public+`, `share+`, `onboarding+`, `file+`, and the rest from `ls -d apps/erp/app/routes/*/`)

**Steps:** Do the sweep procedure on these folders.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** Public HTTP API (`api+/v1+`) response bodies. Do not change them.

---

## Task 22: Sweep ERP components and hooks

**Depends on:** 2–11
**Folders:** `apps/erp/app/components`, `apps/erp/app/hooks`, and every `ui/` folder in `apps/erp/app/modules/*/`

**Steps:** Do the sweep procedure on these folders. Include `apps/erp/app/components/DefaultAttachmentsPanel.tsx:104`: it becomes `toastError(t\`Failed to upload ${file.name}\`, upload.error)`. Include `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderProperties.tsx:80-86`: its `onError` becomes `toastServiceError(data)`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
```

**Out of scope:** Inline cell editors that only set `hasError` (`apps/erp/app/components/Table/components/Cell.tsx`, `Grid/components/Cell.tsx`).

---

## Task 23: Sweep MES

**Depends on:** 2–11
**Folders:** `apps/mes/app/routes`, `apps/mes/app/services`, `apps/mes/app/components`, `apps/mes/app/hooks`

**Steps:** Do the sweep procedure on these folders.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: all tasks successful
pnpm --filter mes test
# Expected: no new failures compared with a run before the task
```

**Out of scope:** `apps/mes/app/services/operations.service.ts:59-95`, which builds PostgREST-shaped errors on purpose. Keep it.

---

## Task 24: Update the rules and AGENTS.md files

**Depends on:** 2–10
**Files:**
- Modify: `.claude/rules/flash-system.md` — the `Result` type gets `description` and `reason`; `flashClientMiddleware` shows `errorDescription(...)` as the second line; add one section "Show why it failed" that names `describeCause`, `toastError`, `toastServiceError` and `requireAffected`
- Modify: `packages/auth/AGENTS.md` — the `error()` reason in Key Exports
- Modify: `packages/api/AGENTS.md` — `./service-fn.server`: `CarbonError.title` and `.reason`; `toResult` sends `title` and `reason`
- Modify: `packages/query/AGENTS.md` — `toastServiceError`, if the file lists exports

**Steps:**
1. Write each change in STE-80 (`.claude/rules/writing-ste.md`).
2. Name only files and functions that exist after Tasks 2–10.

**Verify:**
```bash
rg -n "describeCause|toastServiceError|requireAffected" .claude/rules/flash-system.md packages/auth/AGENTS.md packages/api/AGENTS.md
# Expected: at least 1 match in each of the first 2 files
```

**Out of scope:** Product docs in `docs/`. The change is not a new feature page.

---

## Task 25: Final verification

**Depends on:** all
**Files:**
- Modify: `.ai/plans/2026-10-29-specific-error-toasts.md` — tick the Progress list
- Modify: `.ai/specs/2026-10-29-specific-error-toasts.md` — tick the acceptance criteria that passed

**Steps:**
1. Run each command below, one at a time.
2. Ask the user before `crbn up`. Then start the stack.
3. With the user's permission, use the `/test` skill to check acceptance criteria 1, 3, 4 and 7 in the browser.

**Verify:**
```bash
rg -n 'error\(params,' apps/erp apps/mes
# Expected: no output
pnpm --filter @carbon/utils --filter @carbon/api --filter @carbon/auth --filter @carbon/query test
# Expected: all tests pass
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/api --filter=@carbon/auth --filter=@carbon/query --filter=@carbon/react
# Expected: all tasks successful
pnpm exec turbo run typecheck --filter=erp
# Expected: all tasks successful
pnpm exec turbo run typecheck --filter=mes
# Expected: all tasks successful
pnpm run lint
# Expected: no errors
```

**Out of scope:** Commits. Report the result and ask the user to commit.
