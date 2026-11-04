# Rental agreement contacts — implementation plan

**Spec / source:** `.ai/specs/2026-11-04-rental-agreement-contacts.md`
**Branch:** `feat/rental-multiple-contacts` (worktree `/Users/aashu/work/carbon/carbon-feat-rental-multiple-contacts`)
**Note:** this plan describes the first build (a card with a per-row API). After review the per-row API was replaced by one writer, `saveRentalAgreementContacts`, and the table moved onto setup step 1. The spec's Design section is the current design.
**Sibling:** the rental agreement's own Charges and Deposits cards (UI), the charge routes (actions).

Run every command from the worktree root unless a step says otherwise.
Never commit without the user's permission.

## Progress
- [x] Task 1: Prepare the worktree
- [x] Task 2: Migration — table, trigger, RLS
- [x] Task 3: Regenerate DB types
- [x] Task 4: Validator and building blocks
- [x] Task 5: Operations
- [x] Task 6: Routes and loader data
- [x] Task 7: Contacts card and Add Contact modal
- [x] Task 8: Billing contact field (properties, wizard, new)
- [x] Task 9: Docs and AGENTS.md
- [x] Task 10: Checks and end-to-end verification

## Dependencies
Task 2 needs 1. Task 3 needs 2. Tasks 4 → 5 → 6 → 7 in order. Task 8 needs 6. Task 9 can run any time after 5. Task 10 is last.

---

## Task 1: Prepare the worktree

**Depends on:** none
**Files:** none

**Steps:**
1. Check free RAM (`vm_stat`). Run one heavy command at a time.
2. Run `pnpm install`.
3. Run `crbn up` to write `.env.local` and start this worktree's stack. If the portless proxy is not running, STOP and ask the user to start it.

**Verify:**
```bash
ls .env.local && pnpm exec crbn status 2>&1 | tail -5
# Expected: .env.local exists; the stack reports the database up
```
If `crbn status` does not exist, run `pnpm exec crbn --help` and use the command it lists for status. Do not improvise any other setup.

**Out of scope:** rebuilding or resetting the database.

## Task 2: Migration — table, trigger, RLS

**Depends on:** 1
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_rental-agreement-contacts.sql` (via the command below)
- Modify: `packages/database/src/authz/manifest.ts` — add one rule
- Create: the generated authz migration (via `authz migration`)
- Copy from (precedent): `packages/database/supabase/migrations/20261006220501_rental-agreements.sql`

**Steps:**
1. Run `pnpm db:migrate:new rental-agreement-contacts`. If the HHMMSS part is `000000`, rename the file to a random HHMMSS.
2. Write this SQL into the file:
```sql
CREATE TABLE IF NOT EXISTS "rentalAgreementContact" (
  "id" TEXT NOT NULL DEFAULT id('rac'),
  "companyId" TEXT NOT NULL,
  "rentalAgreementId" TEXT NOT NULL,
  "customerContactId" TEXT NOT NULL REFERENCES "customerContact"("id") ON DELETE CASCADE,
  "role" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "rentalAgreementContact_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "rentalAgreementContact_rentalAgreementId_fkey"
    FOREIGN KEY ("rentalAgreementId", "companyId")
    REFERENCES "rentalAgreement"("id", "companyId") ON DELETE CASCADE,
  CONSTRAINT "rentalAgreementContact_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rentalAgreementContact_unique"
    UNIQUE ("rentalAgreementId", "customerContactId", "companyId"),
  CONSTRAINT "rentalAgreementContact_role_length" CHECK (char_length("role") <= 50)
);
CREATE INDEX IF NOT EXISTS "rentalAgreementContact_companyId_idx" ON "rentalAgreementContact" ("companyId");
CREATE INDEX IF NOT EXISTS "rentalAgreementContact_rentalAgreementId_idx" ON "rentalAgreementContact" ("rentalAgreementId");
CREATE INDEX IF NOT EXISTS "rentalAgreementContact_customerContactId_idx" ON "rentalAgreementContact" ("customerContactId");
CREATE INDEX IF NOT EXISTS "rentalAgreementContact_createdBy_idx" ON "rentalAgreementContact" ("createdBy");

-- Listed contacts belong to the agreement's customer: a new customer drops them.
CREATE OR REPLACE FUNCTION rental_agreement_customer_change_clears_contacts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "rentalAgreementContact"
  WHERE "rentalAgreementId" = NEW."id" AND "companyId" = NEW."companyId";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "rentalAgreement_customer_change_clears_contacts"
  AFTER UPDATE OF "customerId" ON "rentalAgreement"
  FOR EACH ROW
  WHEN (OLD."customerId" IS DISTINCT FROM NEW."customerId")
  EXECUTE FUNCTION rental_agreement_customer_change_clears_contacts();
```
3. In `manifest.ts`, add after `rentalAgreementCharge`: `rentalAgreementContact: company("sales", { read: "sales_view" }),`.
4. Run `pnpm db:migrate`.
5. Run `pnpm --filter @carbon/database authz migration rental-agreement-contacts-rls`.

**Verify:**
```bash
pnpm --filter @carbon/database authz check
# Expected: no changes reported (exit 0)
```
If the `id()` function, `company()` rule or composite FK to `rentalAgreement` is refused, STOP and report.

**Out of scope:** any change to `rentalAgreement` columns.

## Task 3: Regenerate DB types

**Depends on:** 2
**Steps:**
1. Run `pnpm run generate:types` (skip if `pnpm db:migrate` already regenerated them).

**Verify:**
```bash
grep -c "rentalAgreementContact" packages/database/src/types.ts
# Expected: a number above 0
```

## Task 4: Validator and building blocks

**Depends on:** 3
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — next to `rentalAgreementChargeValidator`
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — the "Rental agreements" section, next to `getRentalAgreementDeposits`
- Copy from (precedent): `getRentalAgreementDeposits`, `rentalRefusal`, `updateRentalAgreementInvoiceAutomation` (its email check)

**Steps:**
1. Add the validator:
```ts
export const rentalAgreementContactValidator = z.object({
  customerContactId: z.string().min(1, { message: "Contact is required" }),
  role: zfd.text(z.string().max(50, { message: "Role is 50 characters or fewer" }).optional())
});
```
2. Add `getRentalAgreementContacts(client, rentalAgreementId, companyId)`. Select `id, role, customerContactId, customerContact(id, contact(fullName, email, workPhone, mobilePhone))`, filter by both ids, order by `createdAt` ascending.
3. Add a private helper `openRentalAgreementForContacts(client, rentalAgreementId, companyId)`. It reads `id, status, customerId, customerContactId, invoiceAutomation` from `rentalAgreement`. It returns `rentalRefusal("RENTAL_CONTACT_STATUS", "Contacts can only change on a Draft or Active rental agreement")` when the status is not Draft or Active.
4. Add a private helper `contactOfCustomer(client, customerContactId, customerId, companyId)`. It reads `customerContact` by id and `companyId`, with `contact(email)`. It returns `rentalRefusal("RENTAL_CONTACT_WRONG_CUSTOMER", "This contact does not belong to the agreement's customer")` when the row is missing or its `customerId` differs.
5. Add `insertRentalAgreementContact(client, { rentalAgreementId, customerContactId, role, companyId, createdBy })`:
   1. Run the step-3 helper, then the step-4 helper.
   2. If `customerContactId` equals the agreement's `customerContactId`, return `rentalRefusal("RENTAL_CONTACT_DUPLICATE", "This contact is already on the agreement")`.
   3. Insert. If the insert error code is `23505`, return the same duplicate refusal.
6. Add `updateRentalAgreementContactRole(client, { id, rentalAgreementId, role, companyId, updatedBy })`. Run the status helper, then update `role`, `updatedBy`, `updatedAt: datetime.timestamp()`, filtered by `id`, `rentalAgreementId` and `companyId`.
7. Add `deleteRentalAgreementContact(client, { id, rentalAgreementId, companyId })`. Run the status helper, then delete with the same three filters.
8. Add `setRentalBillingContact(db: Kysely<KyselyDatabase>, client, { rentalAgreementId, customerContactId, companyId, userId, effectiveInvoiceAutomation })`:
   1. Run the status helper and the customer helper with `client`.
   2. If `effectiveInvoiceAutomation === "Post and Email"` and the contact has no email, return `rentalRefusal("RENTAL_INVOICE_EMAIL_NO_CONTACT", "Add a contact with an email to send invoices")`.
   3. In one `db.transaction()`: delete the `rentalAgreementContact` row of the new contact; if the old billing contact is set and differs, insert it as a row with no role (`onConflict` do nothing); update `rentalAgreement.customerContactId`, `updatedBy`, `updatedAt`, filtered by `id` and `companyId`.
   4. Return `{ data: { id: rentalAgreementId }, error: null }`.
9. Read the company default for step 8.2 in the operation (Task 5), not here.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors in sales.models.ts or sales.service.ts
```
If `KyselyDatabase` is not imported in `sales.service.ts`, copy the import from another Kysely building block in the same file.

**Out of scope:** `updateRentalAgreement`, invoice drafting.

## Task 5: Operations

**Depends on:** 4
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.server.ts` — after `setRentalInvoiceAutomation`
- Copy from (precedent): `setRentalInvoiceAutomation` (shape, `@mcp` doc block, `ctx.error`)

**Steps:**
1. Add 4 consts, each `permission: { update: "sales" }`, each with a doc block ending `@mcp`:
   - `addRentalAgreementContact` — input `{ rentalAgreementId, customerContactId, role? }`; calls `service.insertRentalAgreementContact(ctx.asCaller.supabase, { …, companyId: ctx.company.id, createdBy: ctx.auditUserId })`.
   - `updateRentalAgreementContact` — input `{ id, rentalAgreementId, role: string | null }`.
   - `removeRentalAgreementContact` — input `{ id, rentalAgreementId }`.
   - `setRentalAgreementBillingContact` — input `{ rentalAgreementId, customerContactId }`. Read the agreement's `invoiceAutomation`; if null, read `companySettings.invoiceAutomation` for `ctx.company.id`. Call `service.setRentalBillingContact(ctx.asSystem.pg, ctx.asCaller.supabase, …)`.
2. Map an error with a `RENTAL_*` code to `ctx.error("rule", error.message, error)`. Map any other error to `ctx.error("internal", "Failed to update contacts", error)` after `logger.error(…)`.
3. Return `{ id }` on success.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm --filter @carbon/checks exec tsx src/cli.ts service-fn-file 2>&1 | tail -3
# Expected: no finding for sales.server.ts
```
If `@carbon/checks` has no `src/cli.ts`, read `packages/checks/package.json` scripts and run the check that covers `service-fn-file`. Do not skip it.

**Out of scope:** changing `setRentalAgreementTerm`.

## Task 6: Routes and loader data

**Depends on:** 5
**Files:**
- Create: `apps/erp/app/routes/x+/rental-agreement+/$id.contacts.new.tsx`
- Create: `apps/erp/app/routes/x+/rental-agreement+/$id.contacts.$contactId.tsx`
- Create: `apps/erp/app/routes/x+/rental-agreement+/$id.contacts.$contactId.delete.tsx`
- Modify: `apps/erp/app/routes/x+/rental-agreement+/update.tsx` — `intent === "billingContact"`
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.tsx` — load contacts
- Modify: `apps/erp/app/modules/sales/ui/Rentals/types.ts` — `RentalAgreementContact` type, `contacts` on `RentalAgreementRouteData`
- Modify: `apps/erp/app/utils/path.ts` — 3 helpers
- Copy from (precedent): `apps/erp/app/routes/x+/rental-agreement+/$id.$lineId.release.tsx`

**Steps:**
1. Add paths, sorted by name with the other rental paths: `newRentalAgreementContact(id)` → `/rental-agreement/${id}/contacts/new`, `rentalAgreementContact(id, contactId)` → `/rental-agreement/${id}/contacts/${contactId}`, `deleteRentalAgreementContact(id, contactId)` → `/rental-agreement/${id}/contacts/${contactId}/delete`.
2. Write each route like the precedent: SPDX header, `validator(schema).request(args, { params: [...] })`, `carbon(args.request)`, one operation call, then `respond(args.request, result).redirect(requestReferrer(args.request) ?? path.to.rentalAgreementDetails(id), { message })`. Messages: "Contact added", "Role updated", "Contact removed". The delete route takes no body: pass no schema.
3. In `update.tsx`, add before the term fallback: if `intent === "billingContact"`, return `api.sales.setRentalAgreementBillingContact({ rentalAgreementId: id, customerContactId: value ?? "" })`.
4. In `$id.tsx`, add `getRentalAgreementContacts(client, id, companyId)` to the `Promise.all` and return `contacts: contacts.data ?? []`. Also read the billing contact's name, email and phones: change the existing `contact` select to `contact(fullName, email, workPhone, mobilePhone)` and return it as `billingContact` (null when unset). Keep `contactEmail` unchanged.
5. In `types.ts`, add `RentalAgreementContact = NonNullable<Awaited<ReturnType<typeof getRentalAgreementContacts>>["data"]>[number]` (copy the `RentalAgreementDeposit` pattern, type-only import) and a `RentalBillingContact` type `{ id: string; fullName: string | null; email: string | null; workPhone: string | null; mobilePhone: string | null } | null`. Add both to `RentalAgreementRouteData`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** the legacy charge routes.

## Task 7: Contacts card and Add Contact modal

**Depends on:** 6
**Files:**
- Create: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementContacts.tsx`
- Modify: `apps/erp/app/modules/sales/ui/Rentals/index.ts` — export it
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.details.tsx` — render it after `RentalAgreementSummary`
- Modify: `apps/erp/app/routes/x+/rental-agreement+/$id.setup.details.tsx` — render it under the form
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Rentals/RentalDeposits.tsx` (card + table), `RentalAgreementChargeForm.tsx` (ModalDrawer + `ValidatedForm` + fetcher), `RentalAgreementCharges.tsx` (row menu, delete confirm)

**Steps:**
1. Props: `rentalAgreement`, `billingContact`, `contacts`.
2. `canEdit` = status is Draft or Active AND `permissions.can("update", "sales")`.
3. Card title "Contacts", description "Who to call about this rental. The billing contact gets the invoices." Header button "Add Contact" (`LuPlus`) when `canEdit`.
4. Table columns: Name, Role, Email, Phone. First row is the billing contact (when set) with a `Badge` "Billing" next to the name and Role empty. Phone shows `workPhone`, else `mobilePhone`, else empty. Empty state when there is no billing contact and no rows: "No contacts yet."
5. Row menu (`DropdownMenu`, only when `canEdit`, not on the billing row): Edit Role, Make Billing Contact, Remove.
   - Edit Role opens a small modal with an `Input name="role"`, posting to `path.to.rentalAgreementContact(id, row.id)`.
   - Make Billing Contact submits `{ id, intent: "billingContact", value: row.customerContactId }` to `path.to.rentalAgreementUpdate` with a fetcher.
   - Remove opens `ConfirmDelete` (or the confirm the precedent uses), posting to `path.to.deleteRentalAgreementContact(id, row.id)`.
6. Add Contact modal: `ValidatedForm` with `rentalAgreementContactValidator`, `CustomerContact name="customerContactId" customer={rentalAgreement.customerId}`, `Input name="role" label={t\`Role\`}` with helper "For example Site or Ordered by", `Submit`. Action `path.to.newRentalAgreementContact(id)`.
7. All copy through `useLingui().t` or `<Trans>`. Every submit button disables while its fetcher is busy.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check apps/erp/app/modules/sales/ui/Rentals apps/erp/app/routes/x+/rental-agreement+
# Expected: no errors
```

**Out of scope:** the explorer, the header, the shipment and receipt pages.

## Task 8: Billing contact field (properties, wizard, new)

**Depends on:** 6
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementProperties.tsx` — the `customerContactId` field
- Modify: `apps/erp/app/modules/sales/ui/Rentals/RentalAgreementDetailsForm.tsx` — the label

**Steps:**
1. In Properties, relabel the field `t\`Billing Contact\``.
2. Make it read-only only when `isInvoicingReadOnly` (Closed, Cancelled, or no `update: sales`), not `isDisabled`.
3. Replace its `onUpdate("customerContactId", …)` with a new callback that posts `{ id, intent: "billingContact", value }` to `path.to.rentalAgreementUpdate`. Copy `onUpdateInvoiceAutomation`. Skip the post when the value is unchanged.
4. In `RentalAgreementDetailsForm`, relabel the field `t\`Billing Contact\``. Keep the helper text.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** the `customerContactId` term in `setRentalAgreementTerm` (step 1 of the wizard still saves it as a term).

## Task 9: Docs and AGENTS.md

**Depends on:** 5
**Files:**
- Modify: `apps/erp/app/modules/sales/AGENTS.md` — Rentals table list and operations list
- Modify: the reader-facing page that describes rental agreements (find it with `grep -rl "Rental Site\|rental agreement" docs/content/docs/reference`)

**Steps:**
1. In AGENTS.md, add a `rentalAgreementContact` row to the Rentals table: "Other contacts of the agreement's customer, with an optional free-text `role` (≤ 50). The billing contact stays in `rentalAgreement.customerContactId` and is never a row here. Draft or Active only. A customer change deletes the rows (trigger `rentalAgreement_customer_change_clears_contacts`)."
2. Add the 4 operations to the "Rental agreements" line of the Operations list.
3. Add one short "Contacts" paragraph to the docs page. If no page describes rental agreements, skip this step and say so in the final report.

**Verify:**
```bash
grep -n "rentalAgreementContact" apps/erp/app/modules/sales/AGENTS.md
# Expected: at least 1 line
```

## Task 10: Checks and end-to-end verification

**Depends on:** 1–9
**Steps:**
1. Run `pnpm lingui:extract`, then `pnpm lingui:clean`.
2. Run `pnpm --filter @carbon/checks license-headers` to confirm the new files have their SPDX header.
3. Run the scoped typecheck and Biome on the changed folders.
4. Ask the user before browser testing. With permission, use the `/test` skill and walk the spec's acceptance criteria 1, 2, 4, 5, 6 and 7.
5. Update the spec's changelog with anything that changed during the build.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: Tasks: 1 successful
pnpm --filter @carbon/database authz check
# Expected: no changes
```

**Out of scope:** committing. Report the result and ask the user before any commit.
