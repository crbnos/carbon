# Rental agreement contacts

Status: Implemented — not yet committed
Date: 2026-11-04
Sibling: `customerContract` (one invoice contact). No record type in Carbon
holds several contacts yet. The UI copies the rental agreement's own cards.

## TL;DR

- A rental agreement can list any number of the customer's contacts, not just one.
- One of them is the **primary** contact. It gets the invoice emails, as the single contact did before.
- Each other contact has a short free-text role ("Site", "Ordered by").
- Contacts are optional and change while the agreement is Draft or Active. They never touch billing amounts.
- One writer saves the whole list, from setup step 1, a new agreement and the agreement page.

## Problem

A rental agreement had one `customerContactId`. Several people at the customer
deal with one rental:

- the person who orders the units,
- the person on the job site who takes delivery and calls for pickup,
- the accounts person who pays the invoices,
- a backup when the main person can't be reached.

Only one of them could be on the agreement, so the rest lived in notes or in
someone's head. Rentals also run for months, and people change jobs during
that time. The contact could only change while the agreement was Draft.

## Goals

- Add contacts, set their roles and remove them on a Draft or Active agreement.
- Make one contact the primary contact, and change it on a Draft or Active agreement.
- Show each contact's name, role, email and phone, so a driver or a coordinator
  can call the right person.
- Show the contacts table on the first setup step, before the draft is saved.

## Non-goals

- Copying other contacts onto invoices, or CC'ing them on invoice emails. Anyone
  who should always be copied goes in the customer's default CC (`customer.defaultCc`), which already exists.
- Contacts on rental shipments, receipts or their PDFs.
- A fixed list of roles.
- Several contacts on contracts, sales orders or quotes.

## Design

### Data model

The primary contact stays in `rentalAgreement.customerContactId`. Nothing that
reads it changes: invoice drafting (`invoiceCustomerContactId:
agreement.customerContactId`, `sales.service.ts`), the "Post and Email" check
(`updateRentalAgreementInvoiceAutomation`), and the invoice email
(`automate-invoice.ts`, which reads the invoice's contact).

The other contacts are rows of `rentalAgreementContact`
(`20261104063711_rental-agreement-contacts.sql`): `id('rac')`, composite PK,
`rentalAgreementId` (composite FK, cascade), `customerContactId` (FK, cascade),
optional `role` (CHECK ≤ 50 characters), `sortOrder` (the order the contacts were added; the next one takes over as primary), audit columns. One row per
(agreement, contact). RLS is the manifest rule
`company("sales", { read: "sales_view", create: false, update: false, delete: false })`,
shipped by `20261104075634_rental-agreement-contacts-rls.sql`: the API reads the
rows but never writes them, so every write goes through the one writer below,
which checks the status and the customer.

The primary contact is never a row. The SECURITY DEFINER trigger
`rentalAgreement_customer_change_clears_contacts` keeps it that way, inside the
writing transaction:

| Change on `rentalAgreement` | The trigger (BEFORE UPDATE) |
|---|---|
| `customerId` | deletes every row, and clears `customerContactId` unless the same update sets a new one |
| `customerContactId` | deletes the row of the new primary contact |
| insert or update with a primary contact | refuses one that is not the agreement's customer's (`check_violation`) |

It runs as the owner, so the rows go whatever the caller's permissions. A trigger function is not callable as an RPC, and the
definer invariant skips trigger functions.

### The one writer

`saveRentalAgreementContacts(db, { rentalAgreementId, primaryId, contacts,
companyId, userId })` (`sales.service.ts`) makes the primary contact and the
list exactly what it is given. In one Kysely transaction it:

1. Locks the agreement row (`FOR UPDATE`), so two saves cannot undo each other.
2. Refuses an agreement that is not Draft or Active (`RENTAL_CONTACT_STATUS`).
3. Refuses any contact, the primary one included, that is not the agreement's
   customer's (`RENTAL_CONTACT_WRONG_CUSTOMER`).
4. If the primary contact changes while invoices are posted and emailed, refuses
   one with no email (`RENTAL_INVOICE_EMAIL_NO_CONTACT`).
5. Writes `customerContactId`, deletes the rows not in the list, and upserts the
   rest with their roles.

Every write is scoped by `companyId`. Its callers:

| Caller | When |
|---|---|
| `setRentalAgreementContacts` (`sales.server.ts`, `@mcp`, `update: sales`) | the agreement page's table, through `x+/rental-agreement+/$id.contacts.tsx` |
| `createRentalAgreement` (`customerContactId` + `contacts`) | a new agreement from setup step 1; a failure keeps the agreement and returns `warning` |
| `x+/rental-agreement+/$id.setup.details.tsx` | saving setup step 1 of a draft, after the terms |

`rentalAgreementValidator` carries `contacts` (`zfd.json`, at most 100 rows of
`rentalAgreementContactRowValidator`). `setRentalAgreementTerm` no longer takes
`customerContactId`, so the writer is the only way to set the primary contact. Step 1 posts the primary contact as
`customerContactId` and the rest as `contacts`.

### UI

All copy goes through Lingui.

- **`RentalContactsEditor`** — the one table, in a "Contacts" card: Name, Role,
  Email, Phone and a ⋯ menu with **Make Primary** and **Remove**. The primary
  row's Role reads **Primary** with an info icon (`PrimaryContactRole`) that
  explains it. **Add Contact** picks from the customer's contacts; the first one
  added is primary, and removing the primary contact makes the next one primary.
  A role saves when its field loses focus or on Enter.
- **Setup step 1** (`RentalAgreementDetailsForm`, on `new` and
  `$id.setup.details`) — the editor inside the step's form, with the value in
  hidden fields. A new customer resets the list to its sales contact.
- **Agreement page** (`RentalAgreementContacts` on `$id.details`) — the same
  editor. Every change posts the whole list; read-only on a Closed or Cancelled
  agreement or without `update: sales`.
- **Properties panel** — "Primary Contact", read-only. It changes in the table.

## Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Where the primary contact lives | Keep `rentalAgreement.customerContactId` | Every reader (drafting, email check, invoice email) stays unchanged; no data migration |
| Other contacts | Join table `rentalAgreementContact` | Real FK to `customerContact` with cascade; a TEXT[] has no FK and no role |
| Role | Free text, ≤ 50 characters, optional | Every customer names roles differently |
| Name in the UI | "Primary", not "Billing" | It is the main contact; today it gets the invoice emails |
| Invoice email | Primary contact only | Site contacts should not get invoices; always-copied people use `customer.defaultCc` |
| Editable when | Draft and Active | People change during a months-long rental; contacts carry no money |
| How contacts are saved | One writer for the whole list | One rule and one lock for every screen; a per-row add, role, remove and swap API was built first and removed after review |
| Permission | `update: sales` | Contacts are part of the agreement's terms |
| Keep the primary contact out of the list | Trigger on `rentalAgreement` | Holds for every writer, inside its transaction |
| Billing contact optional | Yes, as before | The old field was optional |
| Research | N/A | Internal data-model change; the real-world reasoning is in Problem |

## Acceptance criteria

1. On setup step 1 of a new agreement, a user adds 3 contacts. The first is
   Primary; the others take roles "Site" and "Ordered by". After **Next**, the
   agreement has that primary contact and 2 rows with those roles.
2. Adding a contact that is already in the table does nothing.
3. Saving a contact of a different customer through the API is refused with
   `RENTAL_CONTACT_WRONG_CUSTOMER`, the primary contact included.
4. On an Active agreement's page, a user changes a role, removes a contact and
   makes another one Primary. The old primary contact stays in the list. The
   next drafted invoice's `invoiceCustomerContactId` is the new primary contact.
5. With "Post and Email" in effect, making a contact with no email primary is
   refused with "Add a contact with an email to send invoices".
6. On a Closed or Cancelled agreement the table is read-only, and the save refuses.
7. Changing the customer on a draft clears the contacts.
8. A user without `sales_view` cannot read the table (RLS).
9. Invoice email recipients don't change: To is the invoice contact, CC is the
   existing defaults (`invoiceEmailCc`).

## Open Questions

- [x] How are the contacts organized? — **Answer:** one primary contact plus any
  number of others, each with an optional free-text role.
- [x] Who gets the automatic invoice email? — **Answer:** the primary contact
  only. Site people shouldn't get invoices; always-copied people go in the
  customer's default CC.
- [x] Can contacts change after activation? — **Answer:** yes, on Draft and
  Active. People change jobs during long rentals, and contacts don't affect money.
- [x] Is the primary contact required? — **Answer:** no, as before. So step 1 has
  one contacts table, and the first contact added is primary.
- [x] Billing or Primary? — **Answer:** Primary, with an info tooltip.

## Known gaps

- Step 1 saves the terms, then the contacts, in two transactions. A failed
  contacts save keeps the terms and shows an error; on a customer change the
  trigger has already cleared the old customer's contacts.
- No live-database test pins the writer or the trigger yet.
- Making a contact primary drops its role, and the old primary contact returns
  with no role.

## Changelog

- 2026-11-04 — first draft, written after the first three answers.
- 2026-11-04 — approved, then built with a card on the agreement page and a per-row API.
- 2026-11-04 — the contacts table moved onto setup step 1 upfront; "Billing" became "Primary"; the info tooltip; one ⋯ menu per row.
- 2026-11-04 — after review: one writer (`saveRentalAgreementContacts`) and one operation (`setRentalAgreementContacts`) replace the per-row add, role, remove and swap. The page reuses the step 1 table. The trigger runs as the owner and also drops the new primary contact from the list.
- 2026-11-04 — second review: `customerContactId` left `setRentalAgreementTerm`'s fields; the contacts list is capped at 100; dead loader fields and stale "billing" comments removed.
- 2026-11-04 — CodeRabbit fixes: a new agreement keeps its unit when its contacts fail, and the warning names the reason; contacts keep their order (`sortOrder`); a blank email is no email; the tooltip says when invoices are emailed; the page waits for one save before the next; a customer change clears the old primary contact in the database; the page does not load when its contacts fail to read; the API cannot write contact rows directly.
- 2026-11-04 — CodeRabbit, second round: a new agreement checks its contacts before it is inserted (`checkRentalAgreementContacts`); the trigger refuses a primary contact of another customer on insert and update; a failed contacts read blocks only a Draft or Active agreement page.
