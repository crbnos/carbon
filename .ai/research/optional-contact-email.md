# Research: optional contact email — code audit

> Date: 2026-11-03
> Scope: internal code audit. No competitor research: the change relaxes one field rule, and no external domain logic applies.

## Summary

- The database already allows a NULL `contact.email`. Migration `20251224160904_contacts_simplifications.sql:5` dropped `NOT NULL`.
- Only the shared form rule requires an email: `apps/erp/app/types/validators.ts:29-32`.
- `customerContactValidator` (`sales.models.ts:78`) and `supplierContactValidator` (`purchasing.models.ts:418`) both spread that shared `contact` object.
- No code path crashes on a NULL email. `send-email` drops empty entries from `to` and `cc` (`packages/jobs/src/inngest/functions/notifications/send-email.ts:21-41`).
- The real problem: some "Email" actions send only to the internal user, or skip the send, and then report success.

## Validator detail

| Item | Fact |
|------|------|
| Correct shape | `zfd.text(z.string().email().optional())`. `zfd.text` turns `""` into `undefined`. |
| Why not bare `.optional()` | The edit loaders send `""` (`$supplierId.contacts.$supplierContactId.tsx:114`, `$customerId.contacts.$customerContactId.tsx:114`). `.email()` rejects `""`. |
| Clear on edit | `sanitize` turns `undefined` into `null` (`packages/utils/src/supabase.ts:13-17`). `updateSupplierContact` and `updateCustomerContact` use it. |
| Insert | An undefined `email` leaves the column NULL (`purchasing.service.ts:1450`, `sales.service.ts:2247`). |
| Names | `firstName` and `lastName` are already optional. Without a new rule, a contact can have no name and no email. |
| `fullName` | A generated column. It falls back to `email` when both names are NULL (`20241015022612_contact-import.sql:35-42`). |

## A1 — Sends to the wrong people, or reports false success

| Path | File:line | Today, with no email |
|------|-----------|----------------------|
| Sales order email | `shared.service.ts:1215,1252,1272` (`sendSalesOrderEmail`) | Sends only to the seller. Returns `{success:true}`. Callers: `sales.server.ts:1281`, `sales.server.ts:2024`. |
| Quote finalize email | `sales.service.ts:12510,12534` (`emailQuote`) | Sends only to the user. Finalize returns `warning:null`. Caller: `sales.server.ts:1179-1189`. |
| Sales invoice post (Email) | `invoicing.service.ts:5372,5396,5409` | Sends only to the seller. `stampSent` then sets `sentAt`, so the invoice looks sent. |
| Supplier quote send | `purchasing.server.ts:782-785` (`sendSupplierQuoteToSupplier`) | Sends only to the buyer. Returns success. |
| CSV import | `imports.models.ts:905-909`, about `:1052`, `:2300-2303`, `:2395-2398`; `shared.service.ts:7929-7935`, `8052-8058` (`isContactValid`) | Marks email as required and drops rows without one. |

## A2 — Skips the send with no message

| Path | File:line | Today, with no email |
|------|-----------|----------------------|
| PO finalize | `purchasing.service.ts:6913-6914` (`purchaseOrderEmail` returns null); `purchasing.server.ts:2691-2698` | Skips the send. Finalizes the PO. Shows no warning. |
| PO release after approval | `purchasing.service.ts:7018-7050` (`releaseApprovedPurchaseOrder`) | Skips the send. Logs nothing. |
| Purchasing RFQ finalize | `purchasing.server.ts:387-399` | Drops suppliers whose contact has no email from the send list. Shows no warning. |

## B — Already safe

- Invoice automation records `INVOICE_SEND_NO_EMAIL` (`packages/jobs/src/invoicing/automate-invoice.ts:48`, `:714-726`).
- Rental and contract "Post and Email" refuse a contact with no email (`sales.service.ts:8563-8567`, `:9658-9662`).
- `isEmailableContact` in `packages/lib/src/party-contact.ts:66-68` trims and checks the email.
- Portal account creation refuses a contact with no email (`users.service.ts:1106`, `:1499`). The UI hides "Create Account" (`SupplierContacts.tsx:66-70`, `CustomerContacts.tsx:67-71`).
- PDF blocks show the email only when it exists (`packages/documents/src/pdf/blocks/PartiesBlock.tsx:86` and siblings).
- Accounting syncs (QuickBooks, Rillet, Xero) treat email as optional.
- Ramp: `resolveOrCreateRampSpendVendor` returns `null` with no email (`packages/ee/src/ramp/lib/spend.ts:432-434`). A PO still pushes without `vendor_id`. A bill is skipped.
- Contact pickers use `fullName ?? email ?? "Unknown"` (`Form/SupplierContact.tsx:70`, `Form/CustomerContact.tsx:124`, `CreateSupplierModal.tsx:173`). `??` does not catch `""`.

## C — Not affected

- Paperless Parts reads the external contact's email (`packages/ee/src/paperless-parts/lib/lib.ts:1408,1474`).
- `create_rfq_from_model*` RPCs look up contacts by an email parameter. NULL rows do not match.
- `EmailRecipients.tsx` uses employee emails.
