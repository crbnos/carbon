# Optional contact email — implementation plan

**Spec / source:** `.ai/specs/2026-11-03-optional-contact-email.md`
**Research:** `.ai/research/optional-contact-email.md`
**Branch:** `feat/optional-contact-email` (create it from `main`)

🛑 Do not run `git commit`. The user commits by hand. Leave each task's changes in the working tree.

## Progress
- [x] Task 1: Make email optional and add the name-or-email rule
- [x] Task 2: Add the server email checks (building blocks)
- [x] Task 3: Refuse no-email sends in purchasing operations
- [x] Task 4: Refuse no-email sends in sales operations
- [x] Task 5: Refuse no-email sends in the sales invoice post
- [x] Task 6: Add the no-email warning to the contact pickers
- [x] Task 7: Wire the warning into the 4 purchasing modals
- [x] Task 8: Wire the warning into the 4 sales and invoicing modals
- [x] Task 9: Relax the CSV import
- [x] Task 10: Update the product docs
- [ ] Task 11: Extract Lingui strings
- [ ] Task 12: End-to-end verification

## Deviations (recorded during execution)

| Task | Deviation | Why |
|------|-----------|-----|
| 3 | `sendSupplierQuoteToSupplier` has one check, right after the ownership check. | One check before any write covers both places the plan named. |
| 6 | The picker keeps `onMissingEmailChange` in a ref. | An inline callback from a parent would re-run the effect on every render. |
| 8 | `NotificationOptionsForm` in `QuoteToOrderDrawer.tsx` reports `onEmailBlockedChange` to the drawer. | The form owns `notificationType`, and the drawer owns the submit button. |
| 9 | A blank CSV email is deleted from the row for both insert and update. | One rule gives NULL on insert and keeps the stored email on update. |
| 11 | Not done. `pnpm run lingui:extract` fails: `ora` cannot find `string-width`. | The local `node_modules` is out of date. Run `pnpm install`, then the extract. |

## Dependencies
- Task 2 needs Task 1.
- Tasks 3, 4 and 5 need Task 2. They touch different files and can run in parallel.
- Task 6 needs Task 1.
- Tasks 7 and 8 need Task 6. They touch different files and can run in parallel.
- Task 9 is independent.
- Task 10 is independent.
- Task 11 needs Tasks 6, 7 and 8.
- Task 12 needs all other tasks.

## Shared terms

| Term | Meaning |
|------|---------|
| "has an email" | `isEmailableContact(contact)` returns `true`. It trims the email and tests that it is not empty. Source: `packages/lib/src/party-contact.ts:66-68`. ERP code imports it from `~/modules/settings/party-contact`. |
| Supplier refusal text | `The supplier contact has no email address. Pick another contact, or send without email.` |
| Customer refusal text | `The customer contact has no email address. Pick another contact, or send without email.` |
| Picker warning text (Lingui) | ``t`This contact has no email address.` `` |

## Memory rule

Before each `typecheck`, `test` or `build` command, run `vm_stat | head -5` or `top -l 1 | grep PhysMem`. Run one heavy command at a time. Never run two typechecks in parallel.

---

## Task 1: Make email optional and add the name-or-email rule

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/types/validators.ts` — the `email` field in `contact`, plus a new helper.
- Modify: `apps/erp/app/modules/purchasing/purchasing.models.ts:418` — `supplierContactValidator`.
- Modify: `apps/erp/app/modules/sales/sales.models.ts:78` — `customerContactValidator`.
- Modify: `apps/erp/app/modules/purchasing/purchasing.models.test.ts` — new tests.

**Steps:**
1. In `validators.ts`, replace the `email` field of `contact` with:
   ```ts
   email: zfd.text(z.string().email("Must be a valid email").optional()),
   ```
2. In `validators.ts`, after `contact`, add:
   ```ts
   /** A contact needs a first name, a last name or an email. */
   export const hasContactNameOrEmail = (data: {
     firstName?: string;
     lastName?: string;
     email?: string;
   }) =>
     Boolean(
       data.firstName?.trim() || data.lastName?.trim() || data.email?.trim()
     );

   export const contactNameOrEmailMessage = {
     message: "Enter a name or an email",
     path: ["firstName"]
   };
   ```
3. In `purchasing.models.ts`, change `supplierContactValidator` to:
   ```ts
   export const supplierContactValidator = z
     .object({
       id: zfd.text(z.string().optional()),
       ...contact,
       supplierLocationId: zfd.text(z.string().optional())
     })
     .refine(hasContactNameOrEmail, contactNameOrEmailMessage);
   ```
4. Import `hasContactNameOrEmail` and `contactNameOrEmailMessage` from `~/types/validators` in that file. Use the same import line that already brings in `contact`.
5. In `sales.models.ts`, apply the same change to `customerContactValidator`. Keep `customerLocationId` in place of `supplierLocationId`.
6. In `purchasing.models.test.ts`, add `supplierContactValidator` to the import list. Then add this block:
   ```ts
   describe("supplierContactValidator", () => {
     it("accepts a contact with a name and no email", () => {
       const result = supplierContactValidator.safeParse({ firstName: "Test" });
       expect(result.success).toBe(true);
     });
     it("turns an empty email into undefined", () => {
       const result = supplierContactValidator.safeParse({
         firstName: "Test",
         email: ""
       });
       expect(result.success && result.data.email).toBe(undefined);
     });
     it("refuses a contact with no name and no email", () => {
       const result = supplierContactValidator.safeParse({});
       expect(result.success).toBe(false);
       expect(result.error?.issues[0]?.path).toEqual(["firstName"]);
     });
     it("refuses an invalid email", () => {
       const result = supplierContactValidator.safeParse({
         firstName: "Test",
         email: "not-an-email"
       });
       expect(result.success).toBe(false);
     });
   });
   ```

If a caller uses `.extend`, `.omit`, `.pick` or `.shape` on either validator, STOP and report. The `.refine` makes them a `ZodEffects`, which has none of these methods.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm --filter erp exec vitest run app/modules/purchasing/purchasing.models.test.ts
# Expected: all tests pass, including the 4 new supplierContactValidator tests
```

**Out of scope:** the contact form components. `SupplierContactForm.tsx` and `CustomerContactForm.tsx` read the validator, so the field becomes optional with no edit.

---

## Task 2: Add the server email checks (building blocks)

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — add `supplierContactHasEmail` after `getSupplierContact` (line 908).
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — add `customerContactHasEmail` after `getCustomerContact` (line 880).

**Steps:**
1. In `purchasing.service.ts`, add:
   ```ts
   /** Whether a supplier contact can be emailed. A failed read counts as no. */
   export async function supplierContactHasEmail(
     client: SupabaseClient<Database>,
     supplierContactId: string,
     companyId: string
   ) {
     const row = await getSupplierContact(client, supplierContactId, companyId);
     return !!row.data?.contact && isEmailableContact(row.data.contact);
   }
   ```
2. In `sales.service.ts`, add the same function as `customerContactHasEmail`. It calls `getCustomerContact`.
3. In each file, import `isEmailableContact` from `~/modules/settings/party-contact`. If either file already imports from that module, add the name to that import.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm exec biome check apps/erp/app/modules/purchasing/purchasing.service.ts apps/erp/app/modules/sales/sales.service.ts
# Expected: no errors
```

**Out of scope:** `purchaseOrderEmail` and `emailQuote`. Their callers check first, so they stay as they are.

---

## Task 3: Refuse no-email sends in purchasing operations

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/purchasing/purchasing.server.ts`
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — `releaseApprovedPurchaseOrder` only.

**Steps:**
1. In `finalizePurchaseOrderAndNotify` (line 2519), put this check right after the `companyId !== companyId` "not found" check and before `checkPartyContactRequirement`:
   ```ts
   if (
     notification === "Email" &&
     supplierContact &&
     !(await service.supplierContactHasEmail(system, supplierContact, companyId))
   ) {
     return ctx.error(
       "validation",
       "The supplier contact has no email address. Pick another contact, or send without email."
     );
   }
   ```
2. In `decidePurchaseOrderApproval` (line 2771), add the same check before the `approveRequest` call. Use `input.decision === "Approved" && input.notification === "Email" && input.supplierContact` as the condition. Use `system` as the client.
3. In `sendSupplierQuoteToSupplier` (line 703), move nothing. After the existing `if (!supplierContact)` check (line 740), add the same check with `client` as the client. Then add a second check before the `service.sendSupplierQuote` call at line 730:
   1. Read `notification` and `supplierContact` from the input there.
   2. If `notification === "Email"` and `supplierContact` is set and the contact has no email, return the same `validation` error.
4. In `finalizePurchasingRfqAndNotify` (line 327), before the `invokePosting(ctx, "finalize-purchasing-rfq", …)` call:
   1. Collect the `contactId` of each entry in `suppliers` that has one.
   2. If the list is not empty, read `supplierContact` rows with `.select("id, contact(email)")`, `.in("id", ids)` and `.eq("companyId", companyId)`.
   3. If any row fails `isEmailableContact(row.contact ?? {})`, return `ctx.error("validation", "A selected supplier contact has no email address. Pick another contact, or clear it.")`.
5. In `releaseApprovedPurchaseOrder` (`purchasing.service.ts`, about line 7015), add an `else` branch to `if (email) { … }`:
   ```ts
   } else {
     logger.warn("Purchase order not emailed after approval: the supplier contact has no email", {
       purchaseOrderId,
       supplierContactId: supplierContact
     });
   }
   ```

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm exec biome check apps/erp/app/modules/purchasing/purchasing.server.ts apps/erp/app/modules/purchasing/purchasing.service.ts
# Expected: no errors
```

**Out of scope:** Ramp code in `packages/ee/src/ramp/`. It already handles a contact with no email.

---

## Task 4: Refuse no-email sends in sales operations

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.server.ts`
- Modify: `apps/erp/app/modules/shared/shared.service.ts` — `sendSalesOrderEmail` (about line 1215).

**Steps:**
1. In `finalizeAndSendQuote` (line 1077), after the `if (notification === "Email" && !customerContact)` check, add:
   ```ts
   if (
     notification === "Email" &&
     customerContact &&
     !(await service.customerContactHasEmail(serviceRole, customerContact, companyId))
   ) {
     return ctx.error(
       "validation",
       "The customer contact has no email address. Pick another contact, or send without email."
     );
   }
   ```
2. In `convertQuote` (line 1214), add the same check after the `refuseUnlessOwned` check. Use `serviceRole` as the client.
3. In `confirmSalesOrder` (line 1967), add the same check after the `refuseUnlessOwned` check. Use `serviceRole` as the client.
4. In `sendSalesOrderEmail`, after it reads the contact row, add:
   ```ts
   if (!isEmailableContact(contact)) {
     return { success: false, message: "The customer contact has no email address" };
   }
   ```
   Name the variable as the function names it. Match the return shape the function already uses for a failure. Import `isEmailableContact` from `~/modules/settings/party-contact`.

If `sendSalesOrderEmail` has no `{ success: false, message }` failure shape, STOP and report.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm exec biome check apps/erp/app/modules/sales/sales.server.ts apps/erp/app/modules/shared/shared.service.ts
# Expected: no errors
```

**Out of scope:** rental agreement and contract posting. Both already refuse a contact with no email.

---

## Task 5: Refuse no-email sends in the sales invoice post

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.server.ts` — the post operation, before the "Claim: only a Draft" block (about line 667).
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — `sendPostedSalesInvoice` (about line 5355).

**Steps:**
1. In `invoicing.server.ts`, put this check right before `let stripeSend: StripeSendContext | null = null;`:
   ```ts
   if (
     notification === "Email" &&
     (!customerContact ||
       !(await customerContactHasEmail(serviceRole, customerContact, companyId)))
   ) {
     return ctx.error(
       "rule",
       "Invoice not posted — the invoice contact has no email address"
     );
   }
   ```
   Import `customerContactHasEmail` from `~/modules/sales/sales.service`. If `invoicing.server.ts` already imports from that file, add the name to that import.
2. In `sendPostedSalesInvoice`, after `if (!contact) return fail("Failed to get customer contact");`, add:
   ```ts
   if (!isEmailableContact(contact)) {
     return fail("The invoice contact has no email");
   }
   ```
   The text matches `INVOICE_SEND_NO_EMAIL` in `packages/jobs/src/invoicing/automate-invoice.ts:48`.
3. In the same function, change `contact.email!` in the `to` list to `contact.email`. The check in step 2 makes it a string. If TypeScript still reads it as `string | null`, use `contact.email ?? ""` and keep the check.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm exec biome check apps/erp/app/modules/invoicing/invoicing.server.ts apps/erp/app/modules/invoicing/invoicing.service.ts
# Expected: no errors
```

**Out of scope:** the Stripe send path and invoice automation.

---

## Task 6: Add the no-email warning to the contact pickers

**Depends on:** Task 1
**Files:**
- Modify: `apps/erp/app/components/Form/SupplierContact.tsx`
- Modify: `apps/erp/app/components/Form/CustomerContact.tsx`
- Modify: `apps/erp/app/modules/users/ui/Suppliers/CreateSupplierModal/CreateSupplierModal.tsx:173` — label only.
- Copy from (precedent): `apps/erp/app/components/Form/Tool.tsx:63-64` — reads the field value with `useControlField`.

**Steps:**
1. In `SupplierContact.tsx`, add two optional props to `SupplierContactSelectProps`:
   ```ts
   /** Show a warning when the selected contact has no email. */
   warnIfNoEmail?: boolean;
   /** Called when the "selected contact has no email" state changes. */
   onMissingEmailChange?: (missing: boolean) => void;
   ```
2. Read the current value: `const [value] = useControlField<string | undefined>(props.name);`. Import `useControlField` from `@carbon/form`.
3. Find the selected row: `supplierContactsFetcher.data?.data?.find((c) => c.id === value)`.
4. Compute `const missingEmail = !!warnIfNoEmail && !!selected && !isEmailableContact(selected.contact ?? {});`. Import `isEmailableContact` from `~/modules/settings/party-contact`.
5. Call the callback when the state changes:
   ```ts
   useEffect(() => {
     onMissingEmailChange?.(missingEmail);
   }, [missingEmail, onMissingEmailChange]);
   ```
6. Below `<CreatableCombobox … />`, render:
   ```tsx
   {missingEmail && (
     <p className="text-sm text-destructive">{t`This contact has no email address.`}</p>
   )}
   ```
7. Change the option label to `c.contact?.fullName || c.contact?.email || "Unknown"`.
8. Do steps 1 to 7 in `CustomerContact.tsx`. Its rows come from `data?.data` (`useCustomerContacts`).
9. In `CreateSupplierModal.tsx:173`, change `??` to `||` in the same label.

Do not pass `warnIfNoEmail` or `onMissingEmailChange` into `CreatableCombobox`. Take them out of `props` by destructuring.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm exec biome check apps/erp/app/components/Form/SupplierContact.tsx apps/erp/app/components/Form/CustomerContact.tsx apps/erp/app/modules/users/ui/Suppliers/CreateSupplierModal/CreateSupplierModal.tsx
# Expected: no errors
```

**Out of scope:** `packages/form` and `packages/react`. Do not change `CreatableCombobox`.

---

## Task 7: Wire the warning into the 4 purchasing modals

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderFinalizeModal.tsx`
- Modify: `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderApprovalModal.tsx`
- Modify: `apps/erp/app/modules/purchasing/ui/SupplierQuote/SupplierQuoteSendModal.tsx`
- Modify: `apps/erp/app/modules/purchasing/ui/PurchasingRfq/FinalizeRFQModal.tsx`
- Copy from (precedent): `PurchaseOrderFinalizeModal.tsx` after step 1 below.

**Steps:**
1. In `PurchaseOrderFinalizeModal.tsx`:
   1. Add `const [contactMissingEmail, setContactMissingEmail] = useState(false);`.
   2. Pass `warnIfNoEmail` and `onMissingEmailChange={setContactMissingEmail}` to `<SupplierContact name="supplierContact" … />`.
   3. Give the Finalize button `isDisabled={notificationType === "Email" && contactMissingEmail}`.
2. In `PurchaseOrderApprovalModal.tsx`, do step 1 for its picker (line 121) and its submit button (line 135). Use `isApproving && notificationType === "Email" && contactMissingEmail` as the condition.
3. In `SupplierQuoteSendModal.tsx`, do step 1 for its picker (line 170) and the submit button at line 189.
4. In `FinalizeRFQModal.tsx`:
   1. Add `const [missingEmailRows, setMissingEmailRows] = useState<Record<number, boolean>>({});`.
   2. Pass `warnIfNoEmail` and `onMissingEmailChange={(missing) => setMissingEmailRows((rows) => ({ ...rows, [index]: missing }))}` to each `<SupplierContact name={`suppliers[${index}].contactId`} … />`.
   3. Change the submit button to `isDisabled={isLoading || Object.values(missingEmailRows).some(Boolean)}`.

If a submit button already has an `isDisabled` prop, combine the conditions with `||`.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm exec biome check apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderFinalizeModal.tsx apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderApprovalModal.tsx apps/erp/app/modules/purchasing/ui/SupplierQuote/SupplierQuoteSendModal.tsx apps/erp/app/modules/purchasing/ui/PurchasingRfq/FinalizeRFQModal.tsx
# Expected: no errors
```

**Out of scope:** the "Send Via" options. Keep "Email" in the list.

---

## Task 8: Wire the warning into the 4 sales and invoicing modals

**Depends on:** Task 6
**Files:**
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteFinalizeModal.tsx` — picker line 240, button line 254.
- Modify: `apps/erp/app/modules/sales/ui/Quotes/QuoteToOrderDrawer.tsx` — picker line 1119, submit button line 377.
- Modify: `apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderHeader.tsx` — picker line 158, button line 171.
- Modify: `apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoicePostModal.tsx` — picker line 278, button line 327.
- Copy from (precedent): `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderFinalizeModal.tsx` (after Task 7).

**Steps:**
1. In each file, do Task 7 step 1 with `CustomerContact` in place of `SupplierContact`.
2. In `QuoteToOrderDrawer.tsx`, the picker and the submit button are in different components. If they are, lift `contactMissingEmail` into the component that owns `notificationType`. Pass the setter down as a prop.
3. In `SalesInvoicePostModal.tsx`, the picker also shows for "Stripe". Disable the button for a missing email only when `notificationType === "Email"`. Keep the existing `onChange` handler on the picker.

If `QuoteToOrderDrawer.tsx` has no single owner for both `notificationType` and the submit button, STOP and report.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm exec biome check apps/erp/app/modules/sales/ui/Quotes/QuoteFinalizeModal.tsx apps/erp/app/modules/sales/ui/Quotes/QuoteToOrderDrawer.tsx apps/erp/app/modules/sales/ui/SalesOrder/SalesOrderHeader.tsx apps/erp/app/modules/invoicing/ui/SalesInvoice/SalesInvoicePostModal.tsx
# Expected: no errors
```

**Out of scope:** the Stripe customer resolution in `SalesInvoicePostModal.tsx`.

---

## Task 9: Relax the CSV import

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/shared/imports.models.ts` — field maps (lines 905 and 1052) and schemas (lines 2300 and 2395).
- Modify: `apps/erp/app/modules/shared/shared.service.ts` — both `isContactValid` helpers (lines 7929 and 8052) and the contact rows they gate.

**Steps:**
1. In both field maps, set `email.required` to `false`.
2. In both schemas, replace the `email` field with:
   ```ts
   email: z.string().optional().describe("<keep the existing text>"),
   ```
3. In `shared.service.ts`, replace each `isContactValid` with:
   ```ts
   const isContactValid = (record: {
     firstName?: string | null;
     lastName?: string | null;
     email?: string | null;
   }) =>
     Boolean(
       record.firstName?.trim() || record.lastName?.trim() || record.email?.trim()
     );
   ```
4. In both loops, normalize the email right after `pickColumns("contact", …)`:
   1. If `contactData.email` is blank after `trim()`, then for an insert set `email: null`.
   2. For an update with a blank email, delete the `email` key. A re-import with no email must not clear a stored email.
5. If TypeScript used the old type guard (`record is { email: string }`) to narrow `contactData`, fix each narrowed use. Do not cast.

🛑 A blank string must never reach the `email` column. Store NULL for a missing email.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && pnpm exec biome check apps/erp/app/modules/shared/imports.models.ts apps/erp/app/modules/shared/shared.service.ts
# Expected: no errors
```

**Out of scope:** the first name and last name rules of the import. They stay required in the field maps.

---

## Task 10: Update the product docs

**Depends on:** none
**Files:**
- Modify: `docs/content/docs/reference/suppliers-and-customers.mdx` — after line 28.
- Modify: `docs/content/docs/reference/purchase-orders.mdx` — troubleshooting, near line 106.

**Steps:**
1. In `suppliers-and-customers.mdx`, add a paragraph after line 28: "A contact needs a first name, a last name or an email. A contact with no email can go on a document, but Carbon cannot email that document to it. Pick another contact, or send without email."
2. In `purchase-orders.mdx`, add a troubleshooting entry in the same format as its neighbors. Title: `"The supplier contact has no email address"`. Body: "Send Via is set to Email, and the chosen contact has no email. Add an email to the contact, pick another contact, or set Send Via to None."

Do not name a customer, a person or a real part number in either file.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && grep -n "has no email address" docs/content/docs/reference/purchase-orders.mdx docs/content/docs/reference/suppliers-and-customers.mdx
# Expected: one match in each file
```

**Out of scope:** the Ramp docs. They already describe the missing-email case.

---

## Task 11: Extract Lingui strings

**Depends on:** Tasks 6, 7, 8
**Files:**
- Modify (generated): the `.po` catalogs that `lingui extract` writes.

**Steps:**
1. Run `pnpm run lingui:extract`.
2. Run `git status --short`. Keep only `.po` changes that add `This contact has no email address.` or remove nothing else.

If the extract changes more than about 10 unrelated `.po` entries, STOP and report. Do not commit unrelated catalog churn.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon && grep -rl "This contact has no email address." --include=*.po . | head
# Expected: at least one .po file
```

**Out of scope:** `pnpm run translate`.

---

## Task 12: End-to-end verification

**Depends on:** Tasks 1 to 11

**Steps:**
1. Check free memory. Then run the ERP typecheck:
   ```bash
   cd /Users/aashu/work/carbon/carbon && pnpm exec turbo run typecheck --filter=erp
   ```
2. Run the ERP model tests:
   ```bash
   cd /Users/aashu/work/carbon/carbon && pnpm --filter erp exec vitest run app/modules/purchasing app/modules/sales app/modules/invoicing
   ```
3. Run Biome on every changed file: `pnpm exec biome check $(git diff --name-only -- '*.ts' '*.tsx')`.
4. Ask the user before you open a browser. If they agree, use the `/auth` and `/test` skills with `AGENT_BROWSER_SESSION` set. Use one Chrome session only.
5. In the browser, check each item:
   1. Create a supplier contact with first name "Test" and no email. It saves.
   2. Save a contact with no name and no email. The form shows "Enter a name or an email".
   3. Open the PO finalize modal with that contact and Send Via "Email". The warning shows and Finalize is disabled.
   4. Set Send Via to "None". Finalize is enabled, and the PO finalizes.
   5. Open the sales quote finalize modal with a no-email customer contact. The warning shows and the button is disabled.

**Verify:**
```bash
# Step 1 expected: "Tasks: 1 successful" (or all successful) and no TS errors
# Step 2 expected: all test files pass
# Step 3 expected: no errors
```

**Out of scope:** `git commit` and opening a PR. The user does both.
