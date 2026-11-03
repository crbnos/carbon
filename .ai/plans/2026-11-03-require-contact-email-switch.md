# Require email on contacts switch — implementation plan

**Spec / source:** `.ai/specs/2026-11-03-require-contact-email-switch.md`
**Branch:** `feat/optional-contact-email` (same PR, #2110)

🛑 Do not run `git commit` without the user's permission. Run one heavy command (typecheck, test, migrate) at a time, and check free memory first.

## Progress
- [x] Task 1: Migration — add `requireContactEmail` to `supplier` and `customer`
- [x] Task 2: Validators — the email-required variant and the shared message
- [x] Task 3: Server — enforce the switch in the 4 contact building blocks
- [x] Task 4: Server — the toggle operations and the API inputs
- [x] Task 5: CSV import follows the switch
- [x] Task 6: Routes — the toggle route, the loader flag, the field error
- [x] Task 7: UI — the switch in both Contacts tabs, and the form
- [x] Task 8: Docs, Lingui, verification

## Fixed during the browser test

| Bug | Fix |
|-----|-----|
| `updateSupplierContact` / `updateCustomerContact` failed with PGRST201: `supplier` and `supplierContact` are joined by two foreign keys. | Name the key in the embed: `supplier!supplierContact_supplierId_fkey(...)`, `customer!customerContact_customerId_fkey(...)`. |
| Turning the switch off returned 422: `zfd.checkbox` reads only presence, and the switch posts `"false"`. | The toggle routes parse `z.enum(["true", "false"])`. |

## Dependencies
- Task 2 needs nothing. Task 3 needs Tasks 1 and 2. Task 4 needs Task 3.
- Task 5 needs Task 1. Task 6 needs Tasks 4 and 2. Task 7 needs Task 6.
- Task 8 needs all other tasks.

## Change from the spec

The spec recreated the `suppliers` and `customers` views. This plan does not. The Contacts tab loader reads `requireContactEmail` from the base table, which is the only reader. Recreating two large views for one unused column is risk with no gain. Task 8 records this in the spec.

## Shared terms

| Term | Value |
|------|-------|
| Supplier message | `This supplier requires an email on every contact.` (`SUPPLIER_CONTACT_EMAIL_REQUIRED`, `purchasing.models.ts`) |
| Customer message | `This customer requires an email on every contact.` (`CUSTOMER_CONTACT_EMAIL_REQUIRED`, `sales.models.ts`) |
| Blank email | `!email?.trim()` |

---

## Task 1: Migration

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_require-contact-email.sql` with `pnpm db:migrate:new require-contact-email`.

**Steps:**
1. Write:
   ```sql
   ALTER TABLE "supplier" ADD COLUMN "requireContactEmail" BOOLEAN NOT NULL DEFAULT false;
   ALTER TABLE "customer" ADD COLUMN "requireContactEmail" BOOLEAN NOT NULL DEFAULT false;
   ```
2. Run `pnpm db:migrate`. It applies the migration and regenerates the types.

**Verify:** `grep -c requireContactEmail packages/database/src/types.ts` → 6 or more (Row, Insert, Update for both tables).

**Out of scope:** the views.

## Task 2: Validators

**Files:** `apps/erp/app/types/validators.ts`, `purchasing.models.ts`, `sales.models.ts`, `purchasing.models.test.ts`.

**Steps:**
1. In `validators.ts`, add:
   ```ts
   /** The email rule a partner with "Require email on contacts" adds. */
   export const hasContactEmail = (data: { email?: string }) =>
     Boolean(data.email?.trim());
   export const contactEmailRequiredMessage = {
     message: "Email is required",
     path: ["email"]
   };
   ```
2. In `purchasing.models.ts`, export `SUPPLIER_CONTACT_EMAIL_REQUIRED` and `supplierContactEmailRequiredValidator = supplierContactValidator.refine(hasContactEmail, contactEmailRequiredMessage)`.
3. In `sales.models.ts`, do the same for the customer.
4. Add tests: the email-required validator refuses `{ firstName: "Test" }` with path `["email"]`, and accepts `{ firstName: "Test", email: "a@b.co" }`. Add the same 4 base cases for `customerContactValidator` in a new `describe` (in `sales.models.test.ts` if it exists, else `purchasing.models.test.ts` with an import).

**Verify:** `pnpm --filter erp exec vitest run app/modules/purchasing/purchasing.models.test.ts` → all pass.

## Task 3: Enforce the switch in the building blocks

**Files:** `purchasing.service.ts` (`insertSupplierContact`, `updateSupplierContact`), `sales.service.ts` (`insertCustomerContact`, `updateCustomerContact`).

**Steps:**
1. `insertSupplierContact`: select `["id", "requireContactEmail"]` in the existing `owner` read. If `owner.requireContactEmail` and the email is blank, return `SUPPLIER_CONTACT_EMAIL_REQUIRED` (the function already turns a returned string into `ruleError`).
2. `updateSupplierContact`: if the email is blank, read `supplierContact` → `supplier(requireContactEmail)` by `contactId`, before any write. If the switch is on, return `{ data: null, error: ruleError(SUPPLIER_CONTACT_EMAIL_REQUIRED) }`.
3. Do steps 1 and 2 for the customer pair. Read `insertCustomerContact` first; mirror its own owner read.

**Verify:** `pnpm exec biome check` on both files → no errors.

**Out of scope:** the integration syncs (spec: not enforced).

## Task 4: Toggle operations and API inputs

**Files:** `purchasing.server.ts`, `sales.server.ts`.

**Steps:**
1. Change `email: z.string().min(1)` to `email: z.string().optional()` in `insertSupplierContact` (line 5125), `updateSupplierContact` (5233), `updateCustomerContact` (sales 7236). Change `z.string().min(1).optional()` to `z.string().optional()` in `insertCustomerContact` (6913). The building blocks now own the rule.
2. Add `setSupplierRequireContactEmail` (`input: { supplierId, requireContactEmail: boolean }`, `permission: { update: "purchasing" }`). Update `supplier` by `id` and `companyId` with `updatedBy` and `updatedAt`. Return `{ supplierId }`. Tag `@mcp`.
3. Add `setCustomerRequireContactEmail` in `sales.server.ts` with `update: "sales"`.

**Verify:** `pnpm exec biome check` on both files.

## Task 5: CSV import

**Files:** `apps/erp/app/modules/shared/shared.service.ts` (both contact branches of `importCsvTable`).

**Steps:**
1. Before each loop, read the switch of every partner in `external<Supplier|Customer>IdMap` values in one Kysely query.
2. In the loop, if the row's partner has the switch on and `contactData.email` is blank, push `{ row, reason: <message> }` to `summary.errors` and skip the row.

**Verify:** `pnpm exec biome check` on the file.

## Task 6: Routes

**Files:**
- `x+/supplier+/$supplierId.contacts.tsx` and the customer twin: also return `requireContactEmail` read from the base table.
- Create `x+/supplier+/$supplierId.contacts.require-email.tsx` and the customer twin: action only. `validator(z.object({ requireContactEmail: zfd.checkbox() })).request(args, { params })`, then one call to the Task 4 operation, return the result.
- `$supplierId.contacts.new.tsx`, `$supplierId.contacts.$supplierContactId.tsx` and the customer pairs: if the building block's error message is the shared message, return `validationError({ fieldErrors: { email: message } })` (`@carbon/form`).
- `apps/erp/app/utils/path.ts`: add `supplierContactsRequireEmail(id)` and `customerContactsRequireEmail(id)`.

**Verify:** `pnpm exec biome check` on the changed routes.

## Task 7: UI

**Files:** `SupplierContacts.tsx`, `CustomerContacts.tsx`, `SupplierContactForm.tsx`, `CustomerContactForm.tsx`, and the new/edit contact routes that render the form.

**Steps:**
1. Contacts tab: take `requireContactEmail`. In `CardAction`, before `<New>`, render `Switch` (`@carbon/react`) labelled ``t`Require email on contacts` ``. On change, `fetcher.submit({ requireContactEmail: String(checked) }, { method: "post", action: path.to.supplierContactsRequireEmail(id) })`. Disabled without `update: purchasing` (`update: sales` for the customer) or while the fetcher is busy. Show the optimistic value from `fetcher.formData` while it is in flight.
2. Contact form: add prop `requireEmail?: boolean`. When it is true, use the email-required validator and pass `isOptional={false}` to the Email input.
3. The new/edit contact routes read the flag with `useRouteData(path.to.supplierContacts(id))` and pass it to the form.

**Verify:** `pnpm exec biome check` on the files.

## Task 8: Docs, Lingui, verification

1. Spec: replace the Views row with "Not changed: the Contacts tab loader reads the base table". Add the API input fix to the API table.
2. Docs: in `suppliers-and-customers.mdx`, after the contact paragraph, add: "To keep emails required for one supplier or customer, turn on **Require email on contacts** on its Contacts tab."
3. `pnpm run lingui:extract`, then `pnpm run lingui:clean`. Keep only the new message ids.
4. Typecheck: `pnpm exec turbo run typecheck --filter=erp`, after a memory check.
5. Tests: `pnpm --filter erp exec vitest run app/modules/purchasing app/modules/sales app/modules/shared`.
6. Browser: turn the switch on for the test supplier. Save a contact without email → error on Email. Turn it off → it saves.
