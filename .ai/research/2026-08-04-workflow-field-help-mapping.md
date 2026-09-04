# Workflow catalog field → glossary term mapping

Every input field a customer can fill in on a workflow node, mapped to an existing
`@carbon/glossary` `TermId` or marked `NONE`.

Sources read:

- `packages/workflows/src/catalog/actions.ts` — 6 hand-written actions
- `packages/workflows/src/catalog/operations.ts` — 15 operations
- `packages/workflows/src/catalog/entities.ts` — `write` allowlist → 10 `<entity>.update` actions
- `packages/glossary/src/terms.ts` — the term set

Rules applied: an existing term is used only when its definition genuinely describes
*this* field; field-specific slugs beat concept slugs; obvious labels get
`NONE (self-evident)`. Where a mapping is marked **(new)** the term does not exist yet
and is proposed in the last section.

Several mappings are not guesses — the same column already carries that `termId` at its
existing ERP form call site. Those are marked "confirmed at call site".

---

## Hand-written action inputs

| action id | input name | proposed TermId | reason |
|---|---|---|---|
| `job.create` | `itemId` | `item` **(new)** | Carbon's `item` is the umbrella record over Part / Material / Tool / Service / Consumable / Fixture (`itemType` enum, `20230330024716_parts.sql`) — not self-evident, and no term exists. |
| `job.create` | `quantity` | NONE (self-evident) | How many to build. |
| `job.create` | `dueDate` | `job-due-date` **(new)** | Not just a date: `calculateJobPriority` derives the job's schedule rank from it, and `job-deadline-type` decides whether it is hard or soft. |
| `job.create` | `salesOrderLineId` | `job-sales-order-line` **(new)** | Links the job to the `salesOrderLine` it supplies (`job.salesOrderLineId` FK, set by `upsertJob` / job-from-sales-order). Real ERP nuance, no term. |
| `nonConformance.create` | `name` | NONE (self-evident) | Labelled "title". |
| `nonConformance.create` | `description` | NONE (self-evident) | |
| `nonConformance.create` | `priority` | NONE (self-evident) | `nonConformancePriority` = Low / Medium / High / Critical. |
| `nonConformance.create` | `locationId` | NONE (self-evident) | Where the issue occurred. No plain `location` term exists and none is needed. |
| `purchaseOrder.create` | `supplierId` | NONE (self-evident) | No plain `supplier` term exists; the label is enough. |
| `purchaseOrder.create` | `orderDate` | NONE (self-evident) | |
| `purchaseOrder.create` | `supplierReference` | `purchase-order-supplier-order-number` | Same column; `PurchaseOrderForm.tsx` already sets `termId="purchase-order-supplier-order-number"` on `name="supplierReference"` (confirmed at call site). |
| `salesOrder.create` | `customerId` | NONE (self-evident) | |
| `salesOrder.create` | `orderDate` | NONE (self-evident) | |
| `salesOrder.create` | `customerReference` | `customer-document-reference` | Same column; `SalesOrderForm.tsx` already sets `termId="customer-document-reference"` on `name="customerReference"` (confirmed at call site). |
| `notify` | `user` | NONE (self-evident) | Labelled "person". |
| `notify` | `role` | NONE (self-evident) | Labelled "role"; it resolves to a group, but "notify a role" needs no gloss. |
| `notify` | `subject` | NONE (self-evident) | |
| `notify` | `message` | NONE (self-evident) | |
| `notify` | `aboutId` | `workflow-notify-about-record` **(new)** | The record the notification links to; when empty `notify.ts` falls back to `documentId: runId`. Not inferable from the label "about". |
| `notify` | `aboutType` | `workflow-notify-about-record` **(new)** | Second half of the same two-part record reference (the value model has no "any record" type). |
| `webhook` | `url` | `workflow-webhook-url` **(new)** | `checkOutboundUrl` refuses http, refuses 3xx redirects, and refuses hosts resolving to private / link-local addresses; 10 s timeout. Materially constrains what a customer may type. |
| `webhook` | `body` | `workflow-webhook-body` **(new)** | Sent verbatim as the POST payload under `Content-Type: application/json` — the customer must write valid JSON; workflow variables are substituted first (`template: true`). |

---

## Operation inputs

Every operation declares exactly one input, keyed by its entity name and labelled
"record" — the record the number is worked out for. So the honest tooltip is the one
that describes that entity.

| action id | input name | proposed TermId | reason |
|---|---|---|---|
| `purchaseOrder.total` | `purchaseOrder` | `purchase-order` | Describes the record being read. |
| `purchaseOrder.lineCount` | `purchaseOrder` | `purchase-order` | Same. |
| `salesOrder.total` | `salesOrder` | `sales-order` | Same. |
| `salesOrder.lineCount` | `salesOrder` | `sales-order` | Same. |
| `quote.total` | `quote` | `quote` | Same. |
| `receipt.lineCount` | `receipt` | `receipt` | Same. |
| `shipment.lineCount` | `shipment` | `shipment` | Same. |
| `job.totalScrapQuantity` | `job` | `job` | Same. |
| `job.scrapPercentage` | `job` | `job` | Same. |
| `job.operationCount` | `job` | `job` | Same. |
| `job.openOperationCount` | `job` | `job` | Same. |
| `job.earliestOperationStart` | `job` | `job` | Same. |
| `job.latestOperationEnd` | `job` | `job` | Same. |
| `nonConformance.openTaskCount` | `nonConformance` | `nonconformance` | Term is "Non-conformance (issue)" — exactly this entity; "Issue" is only the customer-facing label. |
| `item.quantityOnHand` | `item` | `item` **(new)** | No `item` term exists yet. |

Note: the operation's *output* is not an input and is out of scope. `quote.total` is
declared but always refuses at run time (quote lines price several quantity breaks);
that does not change its input's meaning.

---

## Entity update inputs

Generated `<entity>.update` actions. The first row of each block is the entity-record
input (keyed by the entity name); the rest are the `write` allowlist columns.

| entity (table) | column | proposed TermId | reason |
|---|---|---|---|
| `purchaseOrder` (`purchaseOrder`) | `purchaseOrder` (record) | `purchase-order` | Describes the record being updated. |
| | `supplierReference` | `purchase-order-supplier-order-number` | Confirmed at call site (`PurchaseOrderForm.tsx`). |
| | `orderDate` | NONE (self-evident) | |
| | `assignee` | `assignee` **(new)** | |
| `salesOrder` (`salesOrder`) | `salesOrder` (record) | `sales-order` | |
| | `customerReference` | `customer-document-reference` | Confirmed at call site (`SalesOrderForm.tsx`, label "Customer PO Number"). |
| | `orderDate` | NONE (self-evident) | |
| | `assignee` | `assignee` **(new)** | |
| | `salesPersonId` | NONE (self-evident) | Labelled "Sales Person" in the ERP; no ERP-specific nuance beyond the label. |
| `job` (`job`) | `job` (record) | `job` | |
| | `dueDate` | `job-due-date` **(new)** | |
| | `startDate` | NONE (self-evident) | Plain planned start date (`job.startDate DATE`, edited inline in `JobProperties`). |
| | `assignee` | `assignee` **(new)** | |
| | `priority` | `job-priority` **(new)** | A `DOUBLE PRECISION` fractional index Carbon computes in `calculateJobPriority` from due date + deadline type — writing it directly is nothing like a Low/High priority. |
| | `deadlineType` | `job-deadline-type` | Exact match; `JobProperties.tsx` already sets `termId="job-deadline-type"` on `name="deadlineType"` (confirmed at call site). |
| `item` (`item`) | `item` (record) | `item` **(new)** | |
| | `name` | NONE (self-evident) | |
| | `assignee` | `assignee` **(new)** | |
| `receipt` (`receipt`) | `receipt` (record) | `receipt` | |
| | `assignee` | `assignee` **(new)** | |
| `shipment` (`shipment`) | `shipment` (record) | `shipment` | |
| | `trackingNumber` | NONE (self-evident) | The carrier's tracking number. |
| | `assignee` | `assignee` **(new)** | |
| | `shippingMethodId` | `shipping-method` **(new)** | The chosen method supplies the tracking-URL template and the carrier GL account (see existing `shipping-method-tracking-url` / `shipping-method-carrier-account`); the concept itself has no term. |
| `quote` (`quote`) | `quote` (record) | `quote` | |
| | `expirationDate` | `quote-expiration-date` | Exact match; `QuoteForm.tsx` already sets `termId="quote-expiration-date"` on `name="expirationDate"` (confirmed at call site). |
| | `dueDate` | NONE (self-evident) | Labelled "Due Date" on the quote; no grounded ERP nuance found in code or docs, so no term rather than an invented one. |
| | `assignee` | `assignee` **(new)** | |
| | `estimatorId` | NONE (self-evident) | Labelled "Estimator". |
| | `salesPersonId` | NONE (self-evident) | Labelled "Sales Person". |
| | `customerReference` | `customer-document-reference` | Confirmed at call site (`QuoteForm.tsx`, label "Customer RFQ"). |
| `supplier` (`supplier`) | `supplier` (record) | NONE (self-evident) | No `supplier` term exists and none is warranted. |
| | `accountManagerId` | `supplier-account-manager` | Confirmed at call site (`SupplierForm.tsx`). |
| | `assignee` | `assignee` **(new)** | Deliberately distinct from Account Manager — see the proposed definition. |
| | `supplierTypeId` | `supplier-type-field` | Confirmed at call site (`SupplierForm.tsx`). |
| `customer` (`customer`) | `customer` (record) | NONE (self-evident) | The existing `customer-*` terms are all about other things (portal account, invoice-to party); none defines "customer". |
| | `accountManagerId` | `customer-account-manager` | Confirmed at call site (`CustomerForm.tsx`). |
| | `assignee` | `assignee` **(new)** | |
| | `customerTypeId` | `customer-type-field` | Confirmed at call site (`CustomerForm.tsx`). |
| `nonConformance` (`nonConformance`) | `nonConformance` (record) | `nonconformance` | |
| | `assignee` | `assignee` **(new)** | |
| | `priority` | NONE (self-evident) | Low / Medium / High / Critical. |
| | `dueDate` | NONE (self-evident) | |
| | `nonConformanceTypeId` | `issue-issue-type` | Same column; `IssueForm.tsx` already sets `termId="issue-issue-type"` on `name="nonConformanceTypeId"` (confirmed at call site). |

---

## Proposed new glossary terms

Nine. Each is grounded in the schema or the executor that reads the field.

| slug | term | one-sentence definition | fields that would use it |
|---|---|---|---|
| `assignee` | Assignee | The Carbon user currently responsible for working this record, picked per record from the assignee control and independent of ownership fields like Account Manager or Sales Person. | `assignee` on all ten `<entity>.update` actions (purchaseOrder, salesOrder, job, item, receipt, shipment, quote, supplier, customer, nonConformance) |
| `item` | Item | Carbon's single record for anything with a part number — Part, Material, Tool, Service, Consumable, or Fixture — that jobs, methods, orders, and inventory all point at. | `job.create.itemId`, `item.update` record input, `item.quantityOnHand` input |
| `job-due-date` | Due Date (job) | The date a job's quantity is needed, which together with Deadline Type sets the job's place in its location's schedule queue. | `job.create.dueDate`, `job.update.dueDate` |
| `job-priority` | Job Priority | The job's position in its location's schedule queue — a fractional number Carbon computes from the due date and deadline type rather than a Low/High rating. | `job.update.priority` |
| `job-sales-order-line` | Sales Order Line (job) | The sales order line this job was created to supply, tying the job to the customer demand behind it. | `job.create.salesOrderLineId` |
| `shipping-method` | Shipping Method | The carrier and service a shipment goes out on, supplying the tracking-URL template that turns a tracking number into a link and the carrier account freight posts to. | `shipment.update.shippingMethodId` |
| `workflow-notify-about-record` | About (notification) | The record a workflow notification points at, named as an id plus its kind; leave it empty and the notification links to the workflow run itself. | `notify.aboutId`, `notify.aboutType` |
| `workflow-webhook-url` | Webhook URL | The https address a workflow's webhook step posts to — plain http, redirects, and hosts that resolve to private or link-local addresses are refused, and the call gives up after ten seconds. | `webhook.url` |
| `workflow-webhook-body` | Webhook Body | The request body sent verbatim as the POST payload with a JSON content type, after workflow variables in it are substituted. | `webhook.body` |

---

## Counts

| | Hand-written actions | Operations | Entity updates | Total |
|---|---|---|---|---|
| Total input fields | 22 | 15 | 44 | **81** |
| Mapped to an **existing** term | 2 | 14 | 17 | **33** |
| NONE against today's glossary | 20 | 1 | 27 | **48** |
| — of which a **new** term is proposed | 7 | 1 | 14 | **22** |
| — of which no term is warranted | 13 | 0 | 13 | **26** |

New glossary terms proposed: **9**.
