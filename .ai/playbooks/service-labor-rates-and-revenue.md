# Service Labor Rates, Time Cost Posting and Service Revenue

Last tested: 2026-11-01 (commits 527277fce3, 8f8ed70e50)
Spec: `.ai/specs/2026-10-31-service-labor-rates-and-time-posting.md`
Routes: /x/settings/service, /x/service-job/new, /x/service-job/<id>,
/x/service-job/<id>/time/new, /x/service-job/<id>/estimate/new,
/file/service-job-estimate/<id>.pdf, MES /x/service/<id>,
/x/accounting/revenue-recognition-runs, /x/revenue-recognition-run/<id>,
/x/sales-invoice/<id>/details

## Prerequisites
- Company `Carbon Development` (dbj96cioa0g02e1gpk40), user test@carbon.ms.
- At least one customer (demo: NovaSat Networks, PolarView Earth).
- An accounting cutover (dev: 2025-11-01), or time journals are Provisional.
- `accountDefault.contractAssetAccount` set for the revenue run (dev: set).
  `costOfServiceAccount` and `serviceRevenueAccount` are empty on dev, so the
  time cost debits "Cost of Goods Sold - Direct" and revenue falls back to Sales.
- Use `AGENT_BROWSER_SESSION=<worktree>`.
- Pages load slowly in dev (5-8 s). An empty job body right after a click is
  still loading; wait before you decide it is broken.

## Steps
### 1. Missing-rate warning
- With `companySettings.serviceLaborCostRate` NULL, open any open Billable job
  in the ERP and the MES. Both show the alert "Labor rates are not set. Time
  cannot be logged or billed until they are." with a "Set rates" link to
  ERP `/x/settings/service` (the MES link is absolute to the ERP).
- After rates are set, a job with `laborBillRate` NULL (every demo job made
  before the feature) still shows the SAME alert.

### 2. Settings → Service
- Two react-aria number fields in order: cost per hour (`serviceLaborCostRate`),
  bill rate per hour (`serviceLaborBillRate`). Fill each, then click the card
  header to blur. Check the hidden inputs.
- `requestSubmit` the form whose submit button text starts with "Save".
  Toast: "Service settings updated". Reload: "$40.00" and "$95.00".

### 3. New job
- /x/service-job/new. Comboboxes in order: Customer, Asset (disabled until a
  customer), Customer location, Contact, then the Problem editor
  (contenteditable: click, then `keyboard type`), Coverage, Billing Method,
  Work Site, Location, Priority, Assignee.
- Coverage has no default: choose "Billable".
- `requestSubmit` "Save". Redirects to /x/service-job/<id>. Properties show
  "Bill Rate (per hour)" as a button "$95.00".

### 4. Bill rate and Labor estimate line
- Click the "$95.00" button: it becomes a number textbox. Fill 110, click a
  heading to blur. It saves on blur (`serviceJob.laborBillRate` = 110).
- Explorer "Estimate" row → its "Add" button → drawer "New Estimate Line".
  Radio "Labor" is the default; Hours textbox; helper text "At $110.00 per hour
  (the job's bill rate)". Fill Hours 2, blur, `requestSubmit` the dialog form.
- Expand "Estimate": line "<description> 2 h × $110.00 $220.00".
- PDF: fetch `/file/service-job-estimate/<jobId>.pdf` in the page
  (⋯ → Print Estimate opens it in a new tab). It shows "2 h | $110.00 / h |
  $220.00" and Total $220.00.

### 5. Bill rate lock
- ⋯ (More options) → "Send Estimate". No dialog; status → Awaiting Approval,
  `estimateStatus` Sent. The Bill Rate button is disabled with the text "The
  bill rate is locked: the estimate was sent to the customer."
- To go on: header "Record Response" → Accepted + Customer Name → submit →
  status Open; then header "Start" → In Progress.

### 6. Time cost posting
- Explorer "Time" row → "Add" → drawer "Log Time": Employee, Date
  (segments: click the month spinbutton and `keyboard type "10"`, the day and
  type "30"), Hours, Billable switch, Note. Fill Hours 1.5 + blur, submit.
- Query (expect ±60, Dr COGS/Cost of Service, Cr Labor & Machine Absorption):
  ```sql
  select j."journalEntryId", j."postingDate", a.name, jl.amount, jl."documentLineReference"
  from "journalLine" jl join journal j on j.id=jl."journalId" left join account a on a.id=jl."accountId"
  where jl."documentType"='Service Job' and jl."documentLineReference" like 'service-job-time:%'
  order by j."createdAt" desc limit 6;
  ```
- Click the entry in the explorer ("Test · Oct 30, 2026 · 1.5 h"), set Hours 2,
  submit. A new journal of ±20 posts. `serviceJobTime.unitCost` = 40.
- The posting date is today (company time zone), not the entry date.

### 7. Complete dialog
- Fixed Price job with no price: header "Complete" opens "Complete SJ…" with a
  "Fixed price" field and "This Fixed Price job has no price." Submitting it
  empty shows "Fixed price is required". Fill 500 + blur + submit → Completed,
  `fixedPrice` 500.
- Running clock: MES /x/service/<id> → bottom "Start" button starts the clock
  (`serviceJobTime` row with `startTime`, no `endTime`). In the ERP, "Complete"
  opens a dialog "A clock is still running on this job." with the submit
  "Stop clock and complete". Submit → Completed, the clock row gets `endTime`,
  `hours`, `unitCost` 40, and its own time journal. Complete writes no other
  journal.

### 8. Cancel guard
- On a job with time entries: ⋯ → "Cancel Job" is disabled. Hover its wrapper:
  tooltip "Remove the time entries and return the parts first."

### 9. Revenue accrual (revenue recognition run)
- Accounting → Closing → Revenue Recognition (/x/accounting/revenue-recognition-runs).
  "New Run" opens a dialog with one date field "Period end". It defaults to
  the month after the latest run (10/31/2026 with no runs, then 11/30/2026).
  `requestSubmit` the dialog form ("Create Run"). Redirects to
  /x/revenue-recognition-run/<id> (RR00000N, Draft).
- The page shows a Journal preview (Contract Assets Dr / Sales Cr), then
  "Deferrals" and "Accruals" tables. A service job accrual row shows Source "—"
  (the page does not link service jobs).
- The synthesizer only reads a job CREATED on or before the period end
  (company time zone). A job made on Nov 1 with time back-dated to Oct 30 gets
  no October accrual: it accrues in the November run.
- Rows: `revenueRecognitionSchedule` with `serviceJobId`, type Accrual,
  status Planned, amount = billable hours (entryDate <= periodEnd) × bill rate
  + billable parts/charges. Fixed Price completed by period end = fixedPrice.
  ```sql
  select s.type, s.status, s.amount, s."periodEnd", j."serviceJobId"
  from "revenueRecognitionSchedule" s join "serviceJob" j on j.id=s."serviceJobId"
  order by s."createdAt" desc limit 5;
  ```
- Post: header "Post" is a form button; `requestSubmit` it (no dialog). The
  run gets `journalId`; the Documents panel lists the journal entry. Each job
  posts Dr Contract Assets / Cr Sales (Service Revenue default empty),
  `documentType` 'Service Job', descriptions "Unbilled service accrued" /
  "Service revenue accrued", dated the period end:
  ```sql
  select jo."journalEntryId", jo."postingDate", a.name, jl.amount, jl.description
  from "journalLine" jl join journal jo on jo.id=jl."journalId" join account a on a.id=jl."accountId"
  where jo.id=(select "journalId" from "revenueRecognitionRun" where "runId"='RR00000N')
    and jl."documentType"='Service Job';
  ```
  Amounts are signed by the account's natural balance: + on Contract Assets
  is a debit, + on Sales is a credit.

### 10. Invoice clears the accrual
- On a Completed Billable job: header "Invoice" opens "Invoice SJ…" ("A draft
  sales invoice is created for the job, and the job becomes Invoiced.").
  `requestSubmit` its form ("Create Invoice"). Redirects to
  /x/sales-invoice/<id>/details; the job is Invoiced.
- T&M: one line, `invoiceLineType` 'Labor', no item, unit EA, description
  "Labor", quantity = billable hours, unit price = job bill rate.
- Header "Post" opens "Post Invoice" ("Are you sure you want to post this
  invoice?"); `requestSubmit` its form. Status → Submitted.
- Journal: Dr Accounts Receivable, Cr Contract Assets up to the accrual, Cr
  Sales/Service Revenue for any rest. The accrual row gets
  `billedBySalesInvoiceLineId` = the Labor line id:
  ```sql
  select jo."journalEntryId", a.name, jl.amount, jl."documentType"
  from "journalLine" jl join journal jo on jo.id=jl."journalId" join account a on a.id=jl."accountId"
  where jl."documentId"='<salesInvoice.id>';
  select "billedBySalesInvoiceLineId" from "revenueRecognitionSchedule"
  where "serviceJobId"=(select id from "serviceJob" where "serviceJobId"='SJ…');
  ```

## Selector Notes
- Job page header: "More options" (⋯) is the first button after the job id;
  the status action ("Start", "Complete", "Record Response") is on the right.
- Explorer sections ("Estimate", "Time", "Parts") are buttons; each has an
  "Add" button right after it. Refs change after every revalidation: re-snapshot.
- Drawers are `[role=dialog] form`; submit with
  `f.requestSubmit([...f.querySelectorAll('button')].find(x=>x.type==='submit'))`.
- Screenshots: pass an ABSOLUTE path to `agent-browser screenshot`, or it saves
  under ~/.agent-browser/tmp.
- On login, a "Forgot to Clock Out?" modal can appear (open timecard).
  "I'm Still Working" only dismisses it (sessionStorage); it writes nothing.
- No pdftotext on the machine: render the PDF with `qlmanage -t -s 1400 -o .`.

## Common Failures
- 502 Bad Gateway on the ERP: the `crbn up` ERP child process died
  (2026-11-01, during step 9). The supervisor did not restart it.
- No service accrual for a job in the expected month: check the job's
  `createdAt` in the company time zone. The run skips jobs created after the
  period end, even when their time entries are dated inside it.
- Invoice posting clears every unbilled Accrual row of the job, posted or
  still Planned in a Draft run. Post the run first.
