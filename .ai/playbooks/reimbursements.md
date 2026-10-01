# Reimbursements (import → edit → post → pay)

Last tested: 2026-09-23
Routes: `/x/invoicing/reimbursements` (list), `/x/reimbursements/$id` (detail),
`/x/reimbursements/$id/edit`, `.../pay`, `.../post`, `.../void`

## Prerequisites

- **There is no "new reimbursement" UI, by design.** A reimbursement is imported
  from a spend provider (Ramp) and never hand-created in Carbon. To test, insert
  a Draft fixture directly — see below.
- A `reimbursement` sequence row (`REIMB-%{yyyy}-%{mm}-`). Seeded by the
  reimbursements migration; without it the readable id cannot be allocated.
- `accountDefault.employeeReimbursementsPayableAccount` (2180 Employee
  Reimbursements Payable, class **Liability**). Falls back to `payablesAccount`.
  A non-Liability account makes posting throw rather than post.
- An `employee` row, and an Asset-class account for the payout (e.g.
  `1010 Bank - Cash`).
- `companySettings.accountingEnabled = true`, or posting creates no GL journal.

### Draft fixture (psql)

The worktree's Postgres port is in `.env.local` — **NOT** the root `.env`'s
54322, which is a different stack. Insert must be `Draft`
(`reimbursement_draft_guard`), and `amount > 0`.

```sql
INSERT INTO "reimbursement"
  (id,"companyId","reimbursementId","employeeId",status,integration,
   "reimbursementDate","currencyCode","exchangeRate",amount,
   "payableAccountId",reference,notes,"createdBy","createdAt")
VALUES ('reimb_e2e_0001','<companyId>','REIMB-2026-09-000020','<employeeId>',
        'Draft','ramp','2026-09-20','USD',1,500,
        '<2180 account id>','RAMP-REIMB-e2e','Client dinner + taxi','system',now());

INSERT INTO "reimbursementLine"
  (id,"companyId","reimbursementId","accountId",description,amount,sequence,"createdBy","createdAt")
VALUES ('reimbl_e2e_1','<companyId>','reimb_e2e_0001','<expense acct>','Client dinner',300,0,'system',now()),
       ('reimbl_e2e_2','<companyId>','reimb_e2e_0001','<expense acct>','Taxi',150,1,'system',now());
```

Deliberately unbalanced (450 vs a 500 header) so the balance guard is exercised.

## Steps

### 1. List — `/x/invoicing/reimbursements`
Nav: **Invoicing → Accounts Payable → Reimbursements** (a sibling of Charges).
Columns: Reimbursement ID, Status, Employee, Date, Reference, Amount.

> `/x/reimbursements` with no id renders a BLANK page — that segment is the
> detail layout and has no index route. Always use the `/x/invoicing/...` path
> for the list.

### 2. Detail (read mode) — Draft
Shows the **Source** badge (provider logo + name + external id), header fields,
and a read-only line table. Actions: **Edit**, **Post**.

### 3. Balance guard
- **Read mode:** the Post button is NOT disabled when unbalanced. Submitting it
  is refused server-side and a toast appears after ~4s:
  *"The coding lines must sum to the reimbursement amount before posting"*.
  Status stays `Draft`, `journalId` stays null.
- **Edit mode:** the totals row shows `UNBALANCED` (red) with the running total,
  and **Save and post is disabled**. Balancing flips it to `BALANCED` (green)
  and enables the button. Tolerance is `EPSILON` (1e-6), NOT a cent.

### 4. Edit — `/x/reimbursements/$id/edit`
Per row: account combobox (with class badge), description, **DIMENSION +** chip
(`DimensionSelector`), amount. `Add line item` above and below the rows.
Footer: Cancel / Save / Save and post.

### 5. Post
`requestSubmit` the form whose submitter is **Save and post** (`intent=save-and-post`)
or read-mode **Post**. Creates the journal and flips to `Posted`.

### 6. Verify the journal balances
```sql
SELECT "totalDebits","totalCredits" FROM "journalEntries" WHERE id='<journalId>';
```
Expect equal. Lines are NATURAL-signed (a Liability credit stores `+`), so the
view — which derives sides from account class AND sign — is the check, not the
raw sum.

### 7. Detail (read mode) — Posted
Edit and Post are GONE; actions become **Pay expense** and **Void**. Posting Date
and a linked Journal appear.

### 8. Pay expense
Modal with exactly three fields — Amount (pre-filled to Total Due), Date, Account
(Asset, pre-selected) — matching Rillet's payout endpoint. Submitting creates a
**Posted Disbursement** payment with an `invoiceSettlement` carrying
`targetReimbursementId`, `discountAmount = 0`, `writeOffAmount = 0`.
Payout journal: **DR Employee Reimbursements Payable / CR Bank**.
Once fully settled, **Pay expense disappears** (only Void remains).

## Selector Notes

- Line **amount** inputs are react-aria and hold their value in React state
  (submitted as one hidden JSON field). `agent-browser fill` does NOT commit —
  neither does fill+Tab. Use the native setter:
  ```js
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  el.focus(); setter.call(el,'200');
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true})); el.blur();
  ```
- Buttons need `form.requestSubmit(button)` — a plain `.click()` silently does
  nothing.
- The page body does not scroll; content is in an inner `h-full` container. Use
  `element.scrollIntoView({block:'center'})` to bring the totals row into view.
- Login: fill the email, click Continue, then **wait ~10s** — it is slow, and the
  button briefly reverts to a disabled "Continue" before the redirect lands.

## Common Failures

- **Blank page** → you used `/x/reimbursements` instead of
  `/x/invoicing/reimbursements`.
- **DB test/query failures that look like code bugs** → wrong Postgres port. The
  root `.env` (54322) overrides `.env.local`; read the real port from
  `docker ps`. Re-run an untouched neighbouring suite to tell environment from
  diff.
- **Post silently does nothing** → either you clicked instead of
  `requestSubmit`-ing, or the document is genuinely unbalanced (wait for the
  toast).
