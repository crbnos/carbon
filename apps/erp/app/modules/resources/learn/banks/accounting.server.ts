/**
 * Accounting — question bank. SERVER ONLY.
 *
 * These lean on the rules the docs flag as counterintuitive, because those are
 * what people get wrong in production: accounting is a switch, a supplier bill
 * reconciles on the order line rather than the receipt, posting never means
 * paid, Locked and Closed refuse different things, and a job's only variance
 * lands at close.
 */

import type { LearnQuestion } from "../types";

const D = "https://docs.carbon.ms";
const ACC = `${D}/docs/reference/accounting`;
const INV = `${D}/docs/reference/invoices`;
const PAY = `${D}/docs/reference/payments`;
const CLOSE = `${D}/docs/reference/period-close`;
const DIM = `${D}/docs/reference/dimensions`;
const FIN = `${D}/docs/reference/financial-reports`;
const G_COST = `${D}/guides/job-costing`;
const G_FINISH = `${D}/guides/job-finish-close`;

export const questions: LearnQuestion[] = [
  // ------------------------------------------------- chart of accounts (9)
  {
    slug: "accounting.ledger.01",
    unitSlug: "chart-of-accounts",
    topic: "ledger",
    bloom: "apply",
    kind: "single",
    prompt:
      "A new company has never touched its accounting settings. A receipt is posted for 40 castings. What exists afterwards?",
    options: [
      {
        id: "a",
        text: "Item ledger entries for the 40 castings, and no journal at all"
      },
      { id: "b", text: "A balanced journal and item ledger entries" },
      {
        id: "c",
        text: "Nothing — posting is blocked until accounting is set up"
      },
      { id: "d", text: "A draft journal waiting for accounting to be enabled" }
    ],
    answer: "a",
    explanation:
      "Accounting enabled is off by default. The physical world still moves — the item ledger records quantities and statuses advance — but no journal entries are written until the switch is turned on.",
    docsUrl: ACC
  },
  {
    slug: "accounting.ledger.02",
    unitSlug: "chart-of-accounts",
    topic: "ledger",
    bloom: "remember",
    kind: "single",
    prompt: "How are debits and credits stored on a journal's lines?",
    options: [
      { id: "a", text: "Debits positive, credits negative" },
      { id: "b", text: "Both positive, with a separate side flag" },
      { id: "c", text: "Debits negative, credits positive" },
      { id: "d", text: "One unsigned amount plus a debit/credit account pair" }
    ],
    answer: "a",
    explanation:
      "Debits are positive and credits negative, which is why a journal balances to zero and why report roll-ups have to be sign-aware by account class.",
    docsUrl: ACC
  },
  {
    slug: "accounting.ledger.03",
    unitSlug: "chart-of-accounts",
    topic: "ledger",
    bloom: "apply",
    kind: "single",
    prompt:
      "On the trial balance, an Asset account with a positive balance appears in which column, and why?",
    options: [
      {
        id: "a",
        text: "The debit column — Asset is a normal-debit class, as is Expense"
      },
      {
        id: "b",
        text: "The credit column — an asset is a claim against the company"
      },
      { id: "c", text: "Either, depending on the date range chosen" },
      { id: "d", text: "Neither — the trial balance shows net change only" }
    ],
    answer: "a",
    explanation:
      "Normal-debit classes (Asset, Expense) show a positive balance as a debit; normal-credit classes (Liability, Equity, Revenue) show it as a credit. The class chosen when the account was created is what decides this.",
    docsUrl: FIN
  },
  {
    slug: "accounting.ledger.04",
    unitSlug: "chart-of-accounts",
    topic: "ledger",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which two source types touch the goods-received-not-invoiced accrual?",
    options: [
      { id: "a", text: "Purchase Receipt" },
      { id: "b", text: "Purchase Invoice" },
      { id: "c", text: "Sales Shipment" },
      { id: "d", text: "Job Close" },
      { id: "e", text: "Asset Depreciation" }
    ],
    answer: ["a", "b"],
    explanation:
      "GR/IR is the accrual between receiving goods and being billed for them: the receipt posts inventory or WIP against GR/IR, and the supplier bill clears GR/IR against payables. A shipment relieves inventory to COGS and has nothing to do with it.",
    docsUrl: ACC
  },
  {
    slug: "accounting.ledger.05",
    unitSlug: "chart-of-accounts",
    topic: "ledger",
    bloom: "apply",
    kind: "single",
    prompt:
      "A manual journal is rejected with 'Cannot post to a group account'. What is wrong?",
    options: [
      {
        id: "a",
        text: "A line references a heading account — only leaf posting accounts accept entries"
      },
      {
        id: "b",
        text: "The account belongs to a different company in the group"
      },
      { id: "c", text: "The journal's debits and credits do not balance" },
      { id: "d", text: "The line carries no dimension value" }
    ],
    answer: "a",
    explanation:
      "Group (heading) accounts hold no postings — their totals roll up from their children. Pick the detailed leaf account underneath instead.",
    docsUrl: ACC
  },
  {
    slug: "accounting.ledger.06",
    unitSlug: "chart-of-accounts",
    topic: "ledger",
    bloom: "apply",
    kind: "single",
    prompt:
      "A posted journal used the wrong expense account. How do you correct it?",
    options: [
      {
        id: "a",
        text: "Edit the line — posted journals stay editable until close"
      },
      { id: "b", text: "Delete the journal and re-enter it correctly" },
      {
        id: "c",
        text: "Reverse it and post a new one — Posted → Reversed is the only transition allowed"
      },
      { id: "d", text: "Move it back to Draft, fix the line, and re-post" }
    ],
    answer: "c",
    explanation:
      "A posted journal is immutable: its lines cannot be edited and it cannot be deleted. Reversing writes an offsetting journal and preserves the history of what was originally booked.",
    docsUrl: ACC
  },
  {
    slug: "accounting.ledger.07",
    unitSlug: "chart-of-accounts",
    topic: "ledger",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A controller wants a different inventory account for each item posting group. How does Carbon resolve posting accounts?",
    options: [
      { id: "a", text: "From a posting group attached to each item" },
      {
        id: "b",
        text: "From one company-level set of defaults — slice the result with dimensions instead of splitting the account"
      },
      { id: "c", text: "From an account named on each item record" },
      { id: "d", text: "From the location's own chart of accounts" }
    ],
    answer: "b",
    explanation:
      "There are no per-group posting groups in Carbon. Every flow resolves its accounts from a single company-level default set, and item posting group is one of the dimension axes you slice that account by.",
    docsUrl: ACC
  },
  {
    slug: "accounting.ledger.08",
    unitSlug: "chart-of-accounts",
    topic: "ledger",
    bloom: "apply",
    kind: "single",
    prompt:
      "An accountant says a 12,000 expense is missing from the income statement. The entry sits in the Journal Entries list with status Draft. What is happening?",
    options: [
      {
        id: "a",
        text: "Balances exclude Draft journals — post it and the figure appears"
      },
      {
        id: "b",
        text: "The period must be closed before the entry is included"
      },
      { id: "c", text: "Reports only read entries dated in a Closed period" },
      {
        id: "d",
        text: "The account has to be added to the report's account filter"
      }
    ],
    answer: "a",
    explanation:
      "Only posted (and reversed) entries move a report. That exclusion is exactly why the account ledger, the three statements, and the period-close snapshots always agree with each other.",
    docsUrl: FIN
  },
  {
    slug: "accounting.ledger.09",
    unitSlug: "chart-of-accounts",
    topic: "ledger",
    bloom: "analyze",
    kind: "single",
    prompt:
      "The balance sheet shows a 'Net Income' line inside Equity. What is it, and what should you not do?",
    options: [
      {
        id: "a",
        text: "A real account posted at year end — keep it in the chart of accounts"
      },
      {
        id: "b",
        text: "A computed row summing the income-statement leaves — do not create a Net Income account"
      },
      { id: "c", text: "Retained earnings, written by the period close" },
      {
        id: "d",
        text: "A rounding plug that disappears once the period closes"
      }
    ],
    answer: "b",
    explanation:
      "Undistributed profit lives in Revenue and Expense accounts, so the sheet would otherwise not balance. Carbon sums every income-statement leaf and surfaces it as a calculated equity row — nothing posts to it.",
    docsUrl: FIN
  },

  // -------------------------------------------------------- dimensions (9)
  {
    slug: "accounting.ledger.10",
    unitSlug: "dimensions",
    topic: "ledger",
    bloom: "remember",
    kind: "single",
    prompt: "Where does an entity-type dimension get its values from?",
    options: [
      {
        id: "a",
        text: "Rows of the existing source table — a Location dimension resolves from your locations"
      },
      { id: "b", text: "Dimension value rows you type in yourself" },
      { id: "c", text: "The chart of accounts" },
      { id: "d", text: "The journal's source type" }
    ],
    answer: "a",
    explanation:
      "An entity-type dimension's values are rows of a table you already keep, resolved from whatever the posting already references. Only a Custom dimension needs you to supply the allowed values.",
    docsUrl: DIM
  },
  {
    slug: "accounting.ledger.11",
    unitSlug: "dimensions",
    topic: "ledger",
    bloom: "apply",
    kind: "single",
    prompt:
      "Your journal lines carry no location tag, even though every posting clearly knows its location. Why?",
    options: [
      {
        id: "a",
        text: "No active Location dimension is defined — defining the dimension is what turns tagging on"
      },
      { id: "b", text: "Location is not one of the supported entity types" },
      { id: "c", text: "Locations must be entered as dimension values first" },
      {
        id: "d",
        text: "Only manual journals are tagged; posted documents are not"
      }
    ],
    answer: "a",
    explanation:
      "At posting time Carbon loads every active dimension keyed by entity type and tags a line only when a dimension exists for a fact that line already carries. No dimension on an axis means no tag on that axis.",
    docsUrl: DIM
  },
  {
    slug: "accounting.ledger.12",
    unitSlug: "dimensions",
    topic: "ledger",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You define a Location dimension today. What happens to last month's already-posted journal lines?",
    options: [
      { id: "a", text: "They are back-tagged the next time a report runs" },
      {
        id: "b",
        text: "Nothing — tagging applies to future postings; posted lines are never retroactively tagged"
      },
      { id: "c", text: "They are tagged when the period is closed" },
      { id: "d", text: "The dimension cannot be created once postings exist" }
    ],
    answer: "b",
    explanation:
      "Tags are written by the posting path as each line is built, so they only exist for postings made after the dimension was defined and active. Historic lines stay untagged.",
    docsUrl: DIM
  },
  {
    slug: "accounting.ledger.13",
    unitSlug: "dimensions",
    topic: "ledger",
    bloom: "apply",
    kind: "single",
    prompt:
      "A controller wants cost of goods sold reported per location. What is the Carbon answer?",
    options: [
      { id: "a", text: "Create 'COGS – West' and 'COGS – East' accounts" },
      {
        id: "b",
        text: "Define a Location dimension — postings then tag every line, and the one COGS account slices by location"
      },
      { id: "c", text: "Add a location column to the journal line" },
      { id: "d", text: "Run a separate balance sheet for each location" }
    ],
    answer: "b",
    explanation:
      "Dimensions exist so the chart of accounts stays small. You post to one COGS account and slice it by the tag on each line, instead of multiplying accounts for every combination.",
    docsUrl: DIM
  },
  {
    slug: "accounting.ledger.14",
    unitSlug: "dimensions",
    topic: "ledger",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Purchase lines have carried cost centers for months, but cost centers never show up in ledger reporting. Why?",
    options: [
      {
        id: "a",
        text: "There is no cost-center column on a journal line — a cost center reaches the ledger only as a dimension tag, so a CostCenter dimension has to be defined"
      },
      { id: "b", text: "Cost centers are a budgeting tool and never post" },
      { id: "c", text: "The cost-center hierarchy has to be flattened first" },
      { id: "d", text: "Each cost center needs an owner before it will post" }
    ],
    answer: "a",
    explanation:
      "The standalone cost-center tree you assign to purchase lines puts nothing on the GL by itself. Only a dimension with entity type CostCenter makes postings start tagging their lines.",
    docsUrl: DIM
  },
  {
    slug: "accounting.ledger.15",
    unitSlug: "dimensions",
    topic: "ledger",
    bloom: "remember",
    kind: "single",
    prompt: "How are dimensions and their values scoped?",
    options: [
      {
        id: "a",
        text: "By company group — shared across every company in it, while the tags on a journal line are scoped by company"
      },
      { id: "b", text: "By company, exactly like the journal itself" },
      { id: "c", text: "By location" },
      { id: "d", text: "By fiscal year, so each year can use its own axes" }
    ],
    answer: "a",
    explanation:
      "A dimension you define is shared across the whole company group, alongside the chart of accounts. Only the journal line dimension rows — the actual tags — are company-scoped.",
    docsUrl: DIM
  },
  {
    slug: "accounting.ledger.16",
    unitSlug: "dimensions",
    topic: "ledger",
    bloom: "apply",
    kind: "single",
    prompt:
      "Saving a new cost center fails with 'Owner is required'. What does a cost center need?",
    options: [
      { id: "a", text: "A name and an owner — the user responsible for it" },
      { id: "b", text: "A name and a parent cost center" },
      { id: "c", text: "A name and a linked dimension" },
      { id: "d", text: "A name and a default GL account" }
    ],
    answer: "a",
    explanation:
      "Every cost center names a user who owns the cost. A parent is optional — that is what makes the hierarchy roll up — and it carries no account of its own.",
    docsUrl: DIM
  },
  {
    slug: "accounting.ledger.17",
    unitSlug: "dimensions",
    topic: "ledger",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which two statements describe how a dimension value is stored against a journal line?",
    options: [
      {
        id: "a",
        text: "The stored value id is polymorphic — a dimension value row for a Custom dimension, the entity's own id for an entity-type dimension"
      },
      { id: "b", text: "A line can hold at most one value per dimension" },
      {
        id: "c",
        text: "The value id is a database foreign key, so a bad reference is rejected by Postgres"
      },
      { id: "d", text: "A line may carry several values on the same axis" },
      {
        id: "e",
        text: "The tag is resolved at report time rather than at posting"
      }
    ],
    answer: ["a", "b"],
    explanation:
      "Because the reference target depends on the dimension's entity type, the value id deliberately is not a foreign key — it is enforced in application code — and a unique constraint keeps one value per axis per line.",
    docsUrl: DIM
  },
  {
    slug: "accounting.ledger.18",
    unitSlug: "dimensions",
    topic: "ledger",
    bloom: "apply",
    kind: "single",
    prompt:
      "A manual journal line had three dimension tags. After re-saving the entry with two of them, the third is gone. Why?",
    options: [
      { id: "a", text: "A bug — dimension tags are meant to merge" },
      {
        id: "b",
        text: "Saving replaces a line's tags wholesale: the existing rows are cleared and the submitted set inserted"
      },
      { id: "c", text: "The third dimension was deactivated" },
      { id: "d", text: "The period was locked when the entry was re-saved" }
    ],
    answer: "b",
    explanation:
      "Manual journals tag their lines directly, and the save is a wholesale replace rather than a merge. Re-submit the full set of tags you want on the line — omitted ones are dropped.",
    docsUrl: DIM
  },

  // -------------------------------------------------- purchase invoices (21)
  {
    slug: "accounting.invoices.01",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "apply",
    kind: "single",
    prompt:
      "A supplier bill posts for 500 against a purchase order line where 480 was received and accrued. What does posting do?",
    options: [
      {
        id: "a",
        text: "Clears the goods-received-not-invoiced accrual against the order line and books the 20 difference to variance"
      },
      {
        id: "b",
        text: "Refuses the bill because it does not match the receipt"
      },
      {
        id: "c",
        text: "Posts the whole 500 to GR/IR and leaves the accrual open"
      },
      { id: "d", text: "Splits it into a 480 invoice and a 20 credit memo" }
    ],
    answer: "a",
    explanation:
      "A purchase invoice reconciles on the purchase order line. Posting clears the accrual sitting against that shared line and books any price difference to purchase price variance.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.02",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A buyer insists you cannot bill a purchase order until its receipt is posted. What is actually true?",
    options: [
      {
        id: "a",
        text: "Correct — the invoice links to the receipt and requires it"
      },
      {
        id: "b",
        text: "A receipt is not required — there is no direct receipt link, and the invoice reconciles on the order line"
      },
      { id: "c", text: "A receipt is required only for stocked items" },
      {
        id: "d",
        text: "The invoice can be raised but not posted without a receipt"
      }
    ],
    answer: "b",
    explanation:
      "Reconciliation happens on the purchase order line, not on a receipt. That is why a bill can be entered and posted for goods that have not been received yet.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.03",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "remember",
    kind: "single",
    prompt:
      "A purchase invoice has just been posted. What status does it read?",
    options: [
      { id: "a", text: "Submitted" },
      { id: "b", text: "Open" },
      { id: "c", text: "Paid" },
      { id: "d", text: "Confirmed" }
    ],
    answer: "b",
    explanation:
      "The posted state is named Open on the purchase side and Submitted on the sales side. Both mean the same thing: posted to the ledger and awaiting payment.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.04",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "apply",
    kind: "single",
    prompt:
      "Your controller asks you to mark a posted supplier bill as Paid because the cheque cleared. What do you do?",
    options: [
      { id: "a", text: "Set the invoice's status field to Paid" },
      {
        id: "b",
        text: "Record and post a disbursement applied to that invoice — Paid is computed from settlements"
      },
      { id: "c", text: "Void the invoice and re-raise it as paid" },
      { id: "d", text: "Post a second, zero-value invoice to close it out" }
    ],
    answer: "b",
    explanation:
      "An invoice is settled by a separate posted document applied to it, never by flipping a field. Paid follows from posted settlements covering the balance.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.05",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which invoice statuses are computed from settlements and the due date rather than set by hand?",
    options: [
      { id: "a", text: "Overdue" },
      { id: "b", text: "Partially Paid" },
      { id: "c", text: "Paid" },
      { id: "d", text: "Draft" },
      { id: "e", text: "Voided" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Those three are derived: an unpaid invoice past its due date reads Overdue, and once settlements cover the balance it reads Paid. Draft and Voided are lifecycle states you drive yourself.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.06",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "apply",
    kind: "multi",
    prompt:
      "A supplier bill needs one line for freight with no item behind it, and one line noting the order revision that must add no charge. Which two line types?",
    options: [
      { id: "a", text: "G/L Account" },
      { id: "b", text: "Comment" },
      { id: "c", text: "Fixed Asset" },
      { id: "d", text: "Consumable" },
      { id: "e", text: "Service" }
    ],
    answer: ["a", "b"],
    explanation:
      "A G/L Account line books a cost straight to a ledger account with a description — freight, fees, anything with no item behind it — and a Comment line carries a note with no charge. Fixed Asset is the sales-side-only type.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.07",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "remember",
    kind: "single",
    prompt:
      "Which line type is available on a sales invoice but not on a purchase invoice?",
    options: [
      { id: "a", text: "Fixed Asset" },
      { id: "b", text: "G/L Account" },
      { id: "c", text: "Consumable" },
      { id: "d", text: "Comment" }
    ],
    answer: "a",
    explanation:
      "The two sides differ in exactly one place: sales invoices carry a Fixed Asset line for billing a capitalized asset, and purchase invoices carry a G/L Account line instead.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.08",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "apply",
    kind: "single",
    prompt:
      "'Cannot delete purchase invoice with status Open. Only Draft invoices can be deleted.' How do you undo it?",
    options: [
      { id: "a", text: "Move it back to Draft and delete it" },
      { id: "b", text: "Void it, which writes reversing entries" },
      { id: "c", text: "Ask an admin to delete it with elevated permissions" },
      { id: "d", text: "Post an identical invoice for a negative amount" }
    ],
    answer: "b",
    explanation:
      "Numbers that have entered the books are never erased. Voiding writes reversing entries and keeps the original invoice visible in the history.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.09",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "apply",
    kind: "single",
    prompt:
      "Voiding a posted supplier bill fails with 'Cannot void a purchase invoice with payments applied.' What is the order of operations?",
    options: [
      {
        id: "a",
        text: "Void the invoice — its payments reverse automatically"
      },
      {
        id: "b",
        text: "Reverse or unapply the payments first, then void the invoice"
      },
      { id: "c", text: "Delete the payment, then void the invoice" },
      { id: "d", text: "Close the accounting period, then void" }
    ],
    answer: "b",
    explanation:
      "A settled invoice is holding live settlements. Those have to be reversed or unapplied before the invoice itself can be reversed.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.10",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A posted payment was applied to the wrong supplier bill. How do you correct it?",
    options: [
      { id: "a", text: "Edit the payment's applications and save again" },
      {
        id: "b",
        text: "Void the payment and re-enter it — applications freeze the moment it posts"
      },
      { id: "c", text: "Unapply it from the invoice's side instead" },
      { id: "d", text: "Post a second payment for a negative amount" }
    ],
    answer: "b",
    explanation:
      "Applications can only be edited while the payment is Draft. Once posted they are frozen, so changing how a payment lands means voiding it and re-entering it.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.11",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "apply",
    kind: "multi",
    prompt:
      "A customer settles a 1,000 invoice with 970 in cash; you grant a 25 early-payment discount and forgive the last 5. Which settlement amounts carry those figures?",
    options: [
      { id: "a", text: "Applied" },
      { id: "b", text: "Discount" },
      { id: "c", text: "Write-off" },
      { id: "d", text: "Rounding" },
      { id: "e", text: "Exchange adjustment" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "An invoice settlement carries exactly three amounts — applied, discount, and write-off — and at least one has to be positive. There is no rounding or exchange amount on the row.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.12",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You apply a posted credit memo to an invoice and want to add a 10 early-payment discount to that same settlement. What happens?",
    options: [
      { id: "a", text: "Allowed — a discount can accompany any settlement" },
      {
        id: "b",
        text: "Not allowed — a memo-sourced settlement can only carry an applied amount; discounts and write-offs are for cash payments"
      },
      { id: "c", text: "Allowed only when the memo is a Debit memo" },
      {
        id: "d",
        text: "Allowed, but the discount is booked to the write-off account"
      }
    ],
    answer: "b",
    explanation:
      "A discount is something you grant for paying cash early, and a write-off forgives cash. Neither makes sense when the settlement is funded by credit rather than money.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.13",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "remember",
    kind: "single",
    prompt:
      "Posting an applied credit memo against a customer's sales invoice moves that invoice to which status?",
    options: [
      { id: "a", text: "Credit Note Issued" },
      { id: "b", text: "Debit Note Issued" },
      { id: "c", text: "Voided" },
      { id: "d", text: "Paid" }
    ],
    answer: "a",
    explanation:
      "The customer side reads Credit Note Issued; the equivalent on a supplier invoice is Debit Note Issued. Both mark that a memo — not cash — did the settling.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.14",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A supplier grants you an allowance on a bill you already posted. Which memo, and what does it do?",
    options: [
      {
        id: "a",
        text: "A Debit memo against the supplier — it lowers what you owe, and the bill reads Debit Note Issued"
      },
      {
        id: "b",
        text: "A Credit memo against the supplier — it lowers what you owe"
      },
      {
        id: "c",
        text: "A Credit memo against the customer who bought the part"
      },
      { id: "d", text: "A purchase invoice entered for a negative amount" }
    ],
    answer: "a",
    explanation:
      "A Credit memo lowers what a customer owes or raises what you owe a supplier; a Debit memo does the reverse. Reducing a supplier balance is therefore the Debit memo.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.15",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A customer sends 5,000 but has only 4,200 of open invoices. What can you do?",
    options: [
      { id: "a", text: "Reject the extra 800 and ask for a corrected payment" },
      {
        id: "b",
        text: "Apply 4,200 and leave the remaining 800 on the customer's account as unapplied credit"
      },
      {
        id: "c",
        text: "Apply the full 5,000 across the invoices — over-application is fine at the payment level"
      },
      {
        id: "d",
        text: "Split it into two payments so neither exceeds an invoice"
      }
    ],
    answer: "b",
    explanation:
      "Over-applying a single invoice is blocked, but a payment's cash total is allowed to exceed what it applies. The excess waits on the party's account for a later invoice.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.16",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A customer already has posted credits on account and some open invoices, and sends no money. Can the invoices be cleared?",
    options: [
      { id: "a", text: "No — a payment must carry cash" },
      {
        id: "b",
        text: "Yes — post a payment with zero cash that only applies the party's existing posted credits"
      },
      { id: "c", text: "Yes, but only by voiding the invoices" },
      { id: "d", text: "Yes, by editing each invoice's balance to zero" }
    ],
    answer: "b",
    explanation:
      "A pure credit-application is a payment whose cash total is zero. It is the reason the total amount on a payment is allowed to be zero at all.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.17",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "apply",
    kind: "single",
    prompt:
      "Settlements leave a sales invoice 0.004 short of its total. What does the invoice read?",
    options: [
      { id: "a", text: "Partially Paid, with a 0.004 balance outstanding" },
      {
        id: "b",
        text: "Paid, with a zero balance — dust under one cent is forgiven"
      },
      { id: "c", text: "Overdue, once the due date passes" },
      {
        id: "d",
        text: "Open, until a write-off settlement is posted for the remainder"
      }
    ],
    answer: "b",
    explanation:
      "A balance smaller than the currency can represent would sit open forever. Carbon treats it as fully paid and reads the balance as zero.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.18",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "apply",
    kind: "single",
    prompt:
      "A posted supplier bill has the wrong unit price on one line. Editing fails with 'Cannot modify a confirmed purchase invoice.' What are your options?",
    options: [
      { id: "a", text: "Move the invoice back to Draft and edit it" },
      {
        id: "b",
        text: "Void it and raise a new one, or issue a debit or credit note"
      },
      {
        id: "c",
        text: "Correct the purchase order line instead — the invoice follows it"
      },
      { id: "d", text: "Have the accounting period reopened, then edit" }
    ],
    answer: "b",
    explanation:
      "An invoice locks the moment it leaves Draft, because those numbers have entered the books. Correction is a new posted document, not an in-place edit.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.19",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "apply",
    kind: "single",
    prompt:
      "Posting a payment fails with 'Only posted credits can be applied.' What is wrong?",
    options: [
      {
        id: "a",
        text: "The credit memo being applied is still Draft or has been voided"
      },
      {
        id: "b",
        text: "The memo belongs to a supplier rather than a customer"
      },
      {
        id: "c",
        text: "The memo's amount is larger than the invoice's balance"
      },
      { id: "d", text: "The memo has no reason account set" }
    ],
    answer: "a",
    explanation:
      "A credit only exists as a settleable balance once its memo is posted. Post the memo first, then apply it.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.20",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "remember",
    kind: "single",
    prompt:
      "Besides writing ledger entries, what does posting a purchase invoice do?",
    options: [
      {
        id: "a",
        text: "Bumps the invoiced quantity on each order line and stamps the posting date"
      },
      { id: "b", text: "Marks the linked receipt as billed" },
      { id: "c", text: "Closes the purchase order" },
      { id: "d", text: "Sets the invoice to Paid" }
    ],
    answer: "a",
    explanation:
      "Posting updates how much of each order line has been billed, which is what keeps a later invoice from billing the same quantity twice.",
    docsUrl: INV
  },
  {
    slug: "accounting.invoices.21",
    unitSlug: "purchase-invoices",
    topic: "invoices",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Accounting is disabled for the company and you post a supplier bill. What happens?",
    options: [
      { id: "a", text: "Posting is refused until accounting is enabled" },
      {
        id: "b",
        text: "The invoice moves to Open, but no ledger entries are written"
      },
      {
        id: "c",
        text: "The invoice posts and draft journals are queued for later"
      },
      {
        id: "d",
        text: "The invoice stays in Draft until accounting is enabled"
      }
    ],
    answer: "b",
    explanation:
      "The document lifecycle runs either way — posting bumps the order line and stamps the date. Only the general-ledger entries are gated on the accounting-enabled switch.",
    docsUrl: INV
  },

  // ----------------------------------------------------------- payments (18)
  {
    slug: "accounting.payments.01",
    unitSlug: "payments",
    topic: "payments",
    bloom: "remember",
    kind: "single",
    prompt: "Which payment type settles a purchase invoice?",
    options: [
      { id: "a", text: "A Disbursement — money out to a supplier" },
      { id: "b", text: "A Receipt — money in from a customer" },
      { id: "c", text: "Either; direction is not checked" },
      {
        id: "d",
        text: "Neither — only a credit memo settles a purchase invoice"
      }
    ],
    answer: "a",
    explanation:
      "A Receipt is AR money in and settles sales invoices; a Disbursement is AP money out and settles purchase invoices. Posting enforces the pairing.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.02",
    unitSlug: "payments",
    topic: "payments",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You need to refund a customer who is sitting on an AR credit. Which document?",
    options: [
      { id: "a", text: "A Receipt from the customer" },
      {
        id: "b",
        text: "A Disbursement that pays the customer — direction and party are decoupled precisely so refunds work"
      },
      {
        id: "c",
        text: "A Disbursement to a supplier standing in for the customer"
      },
      { id: "d", text: "A credit memo only — Carbon cannot refund cash" }
    ],
    answer: "b",
    explanation:
      "Direction (money in or out) is deliberately independent of party. That is what lets a Disbursement pay a customer, and a Receipt come from a supplier refunding an AP debit.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.03",
    unitSlug: "payments",
    topic: "payments",
    bloom: "apply",
    kind: "single",
    prompt: "Where does a credit memo's reason account come from?",
    options: [
      { id: "a", text: "You choose it on the memo before posting" },
      {
        id: "b",
        text: "Carbon derives it from the company's account defaults by party side, and stamps it on the memo"
      },
      { id: "c", text: "It defaults to the bank account named on the memo" },
      { id: "d", text: "It is copied from the invoice being settled" }
    ],
    answer: "b",
    explanation:
      "A customer memo uses the sales-discount account and a supplier memo the supplier-payment-discount account. It is stamped on the memo for the audit trail, not picked by the user.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.04",
    unitSlug: "payments",
    topic: "payments",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A supplier issues you a credit for a returned part. Which memo combination, and what does it do to AP?",
    options: [
      { id: "a", text: "Supplier + Debit — AP goes down" },
      { id: "b", text: "Supplier + Credit — AP goes up" },
      { id: "c", text: "Customer + Credit — AR goes down" },
      { id: "d", text: "Supplier + Debit — AP goes up" }
    ],
    answer: "a",
    explanation:
      "Direction says which side of the party's control account moves. On the supplier side a Debit reduces payables and a Credit increases them — the mirror of the customer side.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.05",
    unitSlug: "payments",
    topic: "payments",
    bloom: "apply",
    kind: "multi",
    prompt: "Which two rules govern an invoice settlement's source and target?",
    options: [
      {
        id: "a",
        text: "Exactly one of a payment or a memo funds the settlement"
      },
      {
        id: "b",
        text: "The target is exactly one of a sales invoice, a purchase invoice, or a memo"
      },
      {
        id: "c",
        text: "A payment and a memo may jointly fund one settlement row"
      },
      { id: "d", text: "The target must always be an invoice" },
      {
        id: "e",
        text: "One settlement row may target several invoices at once"
      }
    ],
    answer: ["a", "b"],
    explanation:
      "The row nets one source against one target. A memo can be the target as well as the source, because a balance-increasing memo is itself an open item somebody has to settle.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.06",
    unitSlug: "payments",
    topic: "payments",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A Debit memo raised a customer's balance for an extra charge. How does that get settled?",
    options: [
      { id: "a", text: "It cannot be settled; it has to be voided" },
      {
        id: "b",
        text: "By targeting the memo itself with a settlement — a balance-increasing memo is an open item"
      },
      {
        id: "c",
        text: "By applying it to any of that customer's open invoices"
      },
      { id: "d", text: "By posting a matching Credit memo to cancel it out" }
    ],
    answer: "b",
    explanation:
      "The settlement row's target can be a memo, not just an invoice, which is exactly how a charge raised by a memo gets collected.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.07",
    unitSlug: "payments",
    topic: "payments",
    bloom: "apply",
    kind: "single",
    prompt:
      "You stage an application of an already-posted credit memo through a payment that is still Draft. When does that credit application count?",
    options: [
      {
        id: "a",
        text: "Immediately, because the memo itself is already posted"
      },
      { id: "b", text: "Only when the payment applying it posts" },
      { id: "c", text: "When the target invoice's due date passes" },
      {
        id: "d",
        text: "At period close, with the rest of the month's settlements"
      }
    ],
    answer: "b",
    explanation:
      "Settlements are staged while their source document is Draft and go live when it posts. Tying the memo application to the payment keeps the composer consistent with cash applications.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.08",
    unitSlug: "payments",
    topic: "payments",
    bloom: "remember",
    kind: "single",
    prompt: "Which payment states can be deleted?",
    options: [
      { id: "a", text: "Draft only" },
      { id: "b", text: "Draft and Posted" },
      { id: "c", text: "Posted only" },
      { id: "d", text: "Any state, until the period closes" }
    ],
    answer: "a",
    explanation:
      "Nothing has hit the ledger while a payment is Draft, so it can simply be removed. A posted payment must be voided instead, which preserves history.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.09",
    unitSlug: "payments",
    topic: "payments",
    bloom: "apply",
    kind: "single",
    prompt:
      "You try to void a payment and get 'Cannot void payment in status Draft (only Posted)'. What should you do?",
    options: [
      { id: "a", text: "Post it first so it can then be voided" },
      {
        id: "b",
        text: "Just delete it — a Draft can be edited or deleted outright"
      },
      { id: "c", text: "Reopen the accounting period" },
      { id: "d", text: "Apply it to a zero-value invoice to close it" }
    ],
    answer: "b",
    explanation:
      "Voiding exists to reverse something that already posted. A Draft has written nothing, so deleting it is the correct and cheaper move.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.10",
    unitSlug: "payments",
    topic: "payments",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "A Receipt settles one sales invoice in full — no discount, no write-off, same currency as the invoice. Which two accounts does the journal touch?",
    options: [
      { id: "a", text: "The bank account" },
      { id: "b", text: "The AR control account" },
      { id: "c", text: "The revenue account" },
      { id: "d", text: "The discount account" },
      { id: "e", text: "The realized exchange gain or loss account" }
    ],
    answer: ["a", "b"],
    explanation:
      "A payment books bank against the control account, split per application. Revenue was already booked when the invoice posted, and the discount and FX accounts only appear when there is a discount or a rate difference.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.11",
    unitSlug: "payments",
    topic: "payments",
    bloom: "apply",
    kind: "single",
    prompt:
      "A payment's exchange rate differs from the invoice's. What reconciles the base-currency difference?",
    options: [
      { id: "a", text: "The write-off account absorbs it" },
      {
        id: "b",
        text: "A single realized-FX plug to the realized exchange gain or loss account"
      },
      { id: "c", text: "The discount account absorbs it" },
      {
        id: "d",
        text: "Nothing — the difference is left sitting on the invoice"
      }
    ],
    answer: "b",
    explanation:
      "One plug line balances the journal in base currency. Write-off and discount are business decisions you make deliberately, not a place to hide a rate movement.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.12",
    unitSlug: "payments",
    topic: "payments",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You apply an already-posted credit memo to a customer's open invoice. What does that application post?",
    options: [
      { id: "a", text: "A debit to revenue and a credit to AR" },
      {
        id: "b",
        text: "Nothing beyond any realized FX — both sides sit in AR, so the application is GL-neutral"
      },
      { id: "c", text: "Bank against AR, as though cash had moved" },
      { id: "d", text: "The memo's reason account against AR a second time" }
    ],
    answer: "b",
    explanation:
      "The memo's own posting already moved the control account against the reason account. Applying it afterwards just nets one AR open item against another.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.13",
    unitSlug: "payments",
    topic: "payments",
    bloom: "apply",
    kind: "single",
    prompt:
      "A customer has 800 of unapplied cash from an earlier Receipt. You post a new Receipt of 200 that applies 900. What happens?",
    options: [
      {
        id: "a",
        text: "Refused — applications can never exceed the payment's cash"
      },
      {
        id: "b",
        text: "Accepted — the 700 shortfall draws down the customer's on-account credit"
      },
      {
        id: "c",
        text: "Accepted, with the 700 posted to the write-off account"
      },
      { id: "d", text: "Refused unless the earlier Receipt is voided first" }
    ],
    answer: "b",
    explanation:
      "Applications may exceed a payment's cash as long as the party has enough unapplied credit on their other posted same-direction payments to cover the gap.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.14",
    unitSlug: "payments",
    topic: "payments",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Which payments contribute to the on-account credit a party has available?",
    options: [
      { id: "a", text: "Every posted payment involving that party" },
      {
        id: "b",
        text: "Same-direction posted payments only — a Receipt from a customer leaves credit, a Disbursement to that customer consumes it"
      },
      { id: "c", text: "Draft and posted payments alike, once staged" },
      { id: "d", text: "Only payments recorded in the base currency" }
    ],
    answer: "b",
    explanation:
      "Available credit is the net unapplied cash on the party's other posted payments in the same direction. Mixing directions would count a refund as though it were credit.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.15",
    unitSlug: "payments",
    topic: "payments",
    bloom: "apply",
    kind: "single",
    prompt:
      "Posting fails with 'Applied exceeds payment cash by 300 but only 120 of on-account credit is available.' What resolves it?",
    options: [
      {
        id: "a",
        text: "Add cash to the payment, apply less, or post more credit for the party first"
      },
      { id: "b", text: "Void the target invoice and re-raise it" },
      { id: "c", text: "Reopen the accounting period" },
      { id: "d", text: "Switch the payment from Receipt to Disbursement" }
    ],
    answer: "a",
    explanation:
      "The shortfall between what the payment applies and what it can fund has to close. Only cash on the payment, or genuine posted credit for the party, can close it.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.16",
    unitSlug: "payments",
    topic: "payments",
    bloom: "apply",
    kind: "single",
    prompt:
      "Applying a payment fails with 'Cannot apply payment to invoice … (must be Submitted/Open)'. What is wrong?",
    options: [
      { id: "a", text: "The invoice has not been posted yet" },
      { id: "b", text: "The invoice is already fully Paid" },
      { id: "c", text: "The invoice sits in a closed accounting period" },
      { id: "d", text: "The payment has no bank account set" }
    ],
    answer: "a",
    explanation:
      "Only a posted invoice is a payable open item — Submitted on the sales side, Open on the purchase side. Post the invoice, then settle it.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.17",
    unitSlug: "payments",
    topic: "payments",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Accounting is disabled for the company. You post a Receipt applied to two invoices. What happens?",
    options: [
      { id: "a", text: "Posting is refused" },
      {
        id: "b",
        text: "The payment posts and its settlements apply, but no journal is written"
      },
      {
        id: "c",
        text: "The payment posts and a draft journal waits for accounting"
      },
      { id: "d", text: "The invoices stay unpaid until accounting is enabled" }
    ],
    answer: "b",
    explanation:
      "Settlement is an operational fact, so the invoices still read Paid. Only the ledger side is gated on the accounting-enabled switch.",
    docsUrl: PAY
  },
  {
    slug: "accounting.payments.18",
    unitSlug: "payments",
    topic: "payments",
    bloom: "remember",
    kind: "single",
    prompt: "What does the GL tie-out on the Receivables workbench compare?",
    options: [
      {
        id: "a",
        text: "The subledger balance against the AR control-account balance, flagging any variance"
      },
      { id: "b", text: "This month's invoices against last month's" },
      { id: "c", text: "Posted payments against the bank statement" },
      { id: "d", text: "Invoice totals against their sales orders" }
    ],
    answer: "a",
    explanation:
      "The workbench shows each side as an aged tree of open documents, and the tie-out proves that subledger of open items still agrees with the control account in the ledger.",
    docsUrl: PAY
  },

  // ------------------------------------------------------- period close (18)
  {
    slug: "accounting.period-close.01",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "remember",
    kind: "single",
    prompt: "What is an accounting period's close lifecycle?",
    options: [
      { id: "a", text: "Open → Locked → Closed" },
      { id: "b", text: "Open → Closed → Locked" },
      { id: "c", text: "Draft → Open → Closed" },
      { id: "d", text: "Active → Inactive → Closed" }
    ],
    answer: "a",
    explanation:
      "Close status moves in one direction and comes back only by an explicit unlock or reopen. It is a separate axis from the legacy Active/Inactive flag, which only marks the current period.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.02",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "apply",
    kind: "single",
    prompt:
      "Closing fails with 'Period must be locked before closing.' What now?",
    options: [
      { id: "a", text: "Reopen the previous period first" },
      {
        id: "b",
        text: "Run the 'Lock the period' checklist step to move it Open → Locked, then close"
      },
      {
        id: "c",
        text: "Post the remaining draft journals and retry the close"
      },
      { id: "d", text: "Delete the period and regenerate it" }
    ],
    answer: "b",
    explanation:
      "Closing is only allowed from Locked. Lock is an Action task on the checklist whose button drives that transition.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.03",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A period is Locked and your accountant needs to post a manual adjusting journal dated in it. What happens?",
    options: [
      { id: "a", text: "Refused — Locked blocks every posting" },
      {
        id: "b",
        text: "It posts — Locked refuses operational documents but still accepts accounting adjustments"
      },
      { id: "c", text: "It posts as a draft until the period is unlocked" },
      {
        id: "d",
        text: "It is redirected into the next open period automatically"
      }
    ],
    answer: "b",
    explanation:
      "That is the whole point of Locked: operations are done for the month but the accountants are not. Lock stops receipts, shipments, invoices, and payments while adjustments still go through.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.04",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A service-role edge function tries to insert a journal dated in a Closed period. What stops it?",
    options: [
      { id: "a", text: "Nothing — service-role bypasses the period check" },
      { id: "b", text: "A database trigger rejects the insert" },
      { id: "c", text: "Row-level security policies on the journal table" },
      { id: "d", text: "The close checklist re-runs and blocks it" }
    ],
    answer: "b",
    explanation:
      "The service-layer check is not the only gate. A trigger rejects any insert, delete, or period-move of a journal into or out of a Closed period, so even a privileged job cannot slip one in.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.05",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Which single change to a journal in a Closed period does that trigger still permit?",
    options: [
      { id: "a", text: "Deleting a journal that is still Draft" },
      {
        id: "b",
        text: "A Posted → Reversed status flip, because the offsetting reversal lands in an open period"
      },
      {
        id: "c",
        text: "Editing a line's account, so long as the totals do not change"
      },
      {
        id: "d",
        text: "Moving a journal into the closed period to correct its date"
      }
    ],
    answer: "b",
    explanation:
      "Marking the original reversed does not add anything to the closed month — the actual reversing entry is written into an open period, which is why the flip is safe to allow.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.06",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "remember",
    kind: "single",
    prompt: "What are the three types a period-close checklist task can be?",
    options: [
      { id: "a", text: "Auto, Action, and Manual" },
      { id: "b", text: "Blocker, Warning, and Info" },
      { id: "c", text: "Draft, Posted, and Reversed" },
      { id: "d", text: "Required and Optional" }
    ],
    answer: "a",
    explanation:
      "Auto is a live readiness evaluator, Action is a task whose completion is itself a lifecycle transition, and Manual is a human sign-off. Blocker and Warning are severities on Auto tasks, not types.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.07",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Somebody locked the period outside the checklist. Why does the 'Lock the period' task now show Done?",
    options: [
      {
        id: "a",
        text: "Its Done state is read from the period's close status, not from a stored tick"
      },
      { id: "b", text: "Somebody must have ticked it manually as well" },
      {
        id: "c",
        text: "Action tasks always show Done once the checklist is materialized"
      },
      { id: "d", text: "It was auto-skipped with a default reason" }
    ],
    answer: "a",
    explanation:
      "An Action task's completion is a lifecycle transition. Its button drives the Open → Locked flip, and its state reflects the period rather than a separate record of a click.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.08",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An Auto task shows Open and there is no way to mark it Done. Why not?",
    options: [
      { id: "a", text: "You lack the accounting update permission" },
      {
        id: "b",
        text: "Auto tasks reflect a live evaluator — fix the underlying condition and the check passes"
      },
      { id: "c", text: "It has to be skipped before it can be completed" },
      { id: "d", text: "Auto tasks only resolve at the moment of close" }
    ],
    answer: "b",
    explanation:
      "Auto tasks are never manually completed; their state is derived from the readiness check every time the checklist loads. Ticking one would make the close claim something untrue.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.09",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "apply",
    kind: "single",
    prompt:
      "'Blocker tasks cannot be skipped; resolve the underlying issue first.' What do you do?",
    options: [
      { id: "a", text: "Write a longer skip reason and try again" },
      {
        id: "b",
        text: "Fix the condition — post the pending document, balance the journal — so the check passes"
      },
      { id: "c", text: "Deactivate the task definition for the company" },
      { id: "d", text: "Delete the task instance for this period" }
    ],
    answer: "b",
    explanation:
      "Only Warning tasks can be skipped with a reason. A Blocker hard-stops the close until the state it checks is genuinely correct.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.10",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "apply",
    kind: "single",
    prompt:
      "Skipping a Warning task fails with 'A reason is required to skip a task.' Which is true?",
    options: [
      {
        id: "a",
        text: "Any non-Blocker task can be skipped, but only with a non-empty reason"
      },
      { id: "b", text: "Only Auto tasks can be skipped" },
      { id: "c", text: "A reason is only required when skipping Manual tasks" },
      {
        id: "d",
        text: "A blank reason is accepted and recorded as not applicable"
      }
    ],
    answer: "a",
    explanation:
      "The skip is a record that somebody consciously chose to proceed, so the reason is mandatory every time and a blank one is rejected.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.11",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which seeded readiness checks are Blockers that hard-stop a close?",
    options: [
      { id: "a", text: "Post pending operational documents" },
      { id: "b", text: "Post or re-date draft journal entries" },
      { id: "c", text: "Trial balance in balance for the period" },
      { id: "d", text: "Post depreciation runs covering the period" },
      { id: "e", text: "Match and eliminate intercompany transactions" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Unposted documents, draft journals, and an out-of-balance trial balance would each make the closed month wrong, so they stop the close. Depreciation and intercompany are Warnings you can skip with a reason.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.12",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "analyze",
    kind: "single",
    prompt:
      "The seeded 'Review negative on-hand inventory' Auto task is always failing, though stock looks fine. Why?",
    options: [
      {
        id: "a",
        text: "It has no live evaluator yet, and Auto tasks fail closed — skip it with a reason"
      },
      { id: "b", text: "There is negative stock somewhere you have not found" },
      { id: "c", text: "It is a Blocker and must be resolved before closing" },
      {
        id: "d",
        text: "It only passes once the period has already been closed"
      }
    ],
    answer: "a",
    explanation:
      "An Auto task whose evaluator cannot be found is treated as failing rather than silently passing, so the reason stays visible. It is a Warning, so a reasoned skip clears it.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.13",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "apply",
    kind: "single",
    prompt:
      "You try to close March while February is still Open. What happens?",
    options: [
      { id: "a", text: "March closes; February is unaffected" },
      { id: "b", text: "Refused — earlier periods must be closed first" },
      { id: "c", text: "February is closed automatically along with March" },
      { id: "d", text: "March closes and February is moved to Locked" }
    ],
    answer: "b",
    explanation:
      "Periods close in order, so you close the earliest open one and work forward. Closing out of sequence would snapshot balances that a later posting into February could still change.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.14",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "analyze",
    kind: "single",
    prompt:
      "January, February, and March are all Closed and a correction has to post into January. What must you do?",
    options: [
      { id: "a", text: "Reopen January on its own" },
      {
        id: "b",
        text: "Reopen March, then February, then January — reopening runs from the most recent close backwards"
      },
      { id: "c", text: "Reopen January and February together in one action" },
      { id: "d", text: "Post the correction into March instead" }
    ],
    answer: "b",
    explanation:
      "Reopening refuses while any later period is still Closed. Because snapshots are cumulative, a later closed period embeds January's balances and has to come off first.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.15",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "analyze",
    kind: "single",
    prompt: "What does reopening a Closed period do to its balance snapshots?",
    options: [
      { id: "a", text: "Leaves them — they are historical records" },
      {
        id: "b",
        text: "Deletes its own snapshot and any later one that embedded it; balance reads fall back to a full-history scan"
      },
      { id: "c", text: "Recomputes them immediately from the ledger" },
      {
        id: "d",
        text: "Marks them stale but keeps serving them until the next close"
      }
    ],
    answer: "b",
    explanation:
      "Snapshots are cumulative through their period's end date, so a later snapshot contains the reopened month. Keeping either one would let a report disagree with the ledger.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.16",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "analyze",
    kind: "single",
    prompt: "What is the difference between unlocking and reopening a period?",
    options: [
      { id: "a", text: "They are the same operation under two names" },
      {
        id: "b",
        text: "Unlocking moves Locked → Open and touches no balances; reopening moves Closed → Open and deletes the balance snapshots"
      },
      { id: "c", text: "Unlocking moves a Closed period back to Locked" },
      {
        id: "d",
        text: "Reopening only clears the locked-at and locked-by stamps"
      }
    ],
    answer: "b",
    explanation:
      "Unlocking is the milder inverse: nothing was snapshotted at lock time, so there is nothing to undo. Reopening has to unwind the snapshots the close wrote.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.17",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "remember",
    kind: "single",
    prompt:
      "A company's fiscal year starts in July. What is the year beginning July 2025 called?",
    options: [
      { id: "a", text: "FY2025" },
      { id: "b", text: "FY2026" },
      { id: "c", text: "FY2025-26" },
      { id: "d", text: "It has no label until the year is closed" }
    ],
    answer: "b",
    explanation:
      "A fiscal year is named for the calendar year it ends in, so a July 2025 start runs to June 2026 and is FY2026.",
    docsUrl: CLOSE
  },
  {
    slug: "accounting.period-close.18",
    unitSlug: "period-close",
    topic: "period-close",
    bloom: "apply",
    kind: "multi",
    prompt: "A period is Locked. Which of these postings are refused?",
    options: [
      { id: "a", text: "A supplier bill dated in that period" },
      { id: "b", text: "A customer payment dated in that period" },
      { id: "c", text: "A shipment dated in that period" },
      {
        id: "d",
        text: "A manual journal dated in that period, posted as an accounting adjustment"
      },
      { id: "e", text: "A manual journal dated in the following, Open period" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "Locked refuses operational documents — receipts, shipments, invoices, and payments. Accounting adjustments into the locked month still pass, and a posting dated in an Open period was never in scope.",
    docsUrl: CLOSE
  },

  // --------------------------------------------------------- job costing (15)
  {
    slug: "accounting.costing.01",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "apply",
    kind: "single",
    prompt:
      "A job is issued 12 castings from stock. What does the ledger show?",
    options: [
      {
        id: "a",
        text: "A debit to work-in-process and a credit to inventory, tagged Job Consumption"
      },
      { id: "b", text: "A debit to inventory and a credit to work-in-process" },
      {
        id: "c",
        text: "A debit to cost of goods sold and a credit to inventory"
      },
      { id: "d", text: "Nothing, until the job completes" }
    ],
    answer: "a",
    explanation:
      "Consuming a part moves its cost out of inventory and into the job's work-in-process. That is one of the two streams that fill WIP.",
    docsUrl: G_COST
  },
  {
    slug: "accounting.costing.02",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A plant manager wants to switch a part from issued to backflushed to change how it hits the books. What do you tell them?",
    options: [
      {
        id: "a",
        text: "Backflushed material is booked to COGS instead of WIP"
      },
      {
        id: "b",
        text: "The posting is identical either way — only the timing differs, so the choice is floor discipline, not accounting"
      },
      { id: "c", text: "Backflushed material is valued at standard cost" },
      { id: "d", text: "Backflushing bypasses WIP entirely" }
    ],
    answer: "b",
    explanation:
      "Issuing pushes material as the work happens; backflushing sweeps whatever the method called for at completion. Both post cost out of inventory and into WIP.",
    docsUrl: G_COST
  },
  {
    slug: "accounting.costing.03",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An operation was estimated at 2 hours; the operator logs 3 hours at the work center. What is priced into WIP?",
    options: [
      { id: "a", text: "The operation's 2-hour estimate" },
      { id: "b", text: "The 3 hours logged, at the work center's own rates" },
      { id: "c", text: "The lower of the estimate and the actual" },
      {
        id: "d",
        text: "Nothing until the job closes and the variance is swept"
      }
    ],
    answer: "b",
    explanation:
      "Every production event carries a real duration and is priced against the work center's labor, machine, and overhead rates — never against the operation's estimate.",
    docsUrl: G_COST
  },
  {
    slug: "accounting.costing.04",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "apply",
    kind: "multi",
    prompt: "Which postings add cost to a job's work-in-process?",
    options: [
      { id: "a", text: "Material consumed, tagged Job Consumption" },
      { id: "b", text: "Priced production events, tagged Production Event" },
      { id: "c", text: "The sales shipment, tagged Sales Shipment" },
      { id: "d", text: "The finished-goods receipt, tagged Job Receipt" },
      { id: "e", text: "The residual sweep at close, tagged Job Close" }
    ],
    answer: ["a", "b"],
    explanation:
      "Only two streams fill WIP: consumed material, and labor, machine and overhead time. Job Receipt and Job Close both empty it, and the shipment relieves inventory rather than WIP.",
    docsUrl: G_COST
  },
  {
    slug: "accounting.costing.05",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "The work center carrying an operation also has an overhead rate. What does a production event post?",
    options: [
      {
        id: "a",
        text: "One pair only: WIP against a labor absorption account"
      },
      {
        id: "b",
        text: "A second pair as well — debit WIP, credit an overhead-absorption account at that rate"
      },
      { id: "c", text: "Overhead is added in one lump at job close" },
      { id: "d", text: "Overhead is applied to COGS when the unit is sold" }
    ],
    answer: "b",
    explanation:
      "Labor and machine time each post at their own rate, and an overhead rate on the work center absorbs a further debit into WIP alongside the time — gated on the overhead-absorption account being configured.",
    docsUrl: G_COST
  },
  {
    slug: "accounting.costing.06",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "remember",
    kind: "single",
    prompt: "Where does a job's work-in-process balance live?",
    options: [
      { id: "a", text: "In a WIP cost column on the job record" },
      {
        id: "b",
        text: "In the general ledger — the sum of postings against the WIP account carrying that job's id"
      },
      { id: "c", text: "In the remaining quantity on the job's cost layers" },
      { id: "d", text: "In the item ledger, alongside the quantities" }
    ],
    answer: "b",
    explanation:
      "WIP is not a table or a field you can read off a job. It is a query over the ledger, which is why it is provably zero once the job closes.",
    docsUrl: G_COST
  },
  {
    slug: "accounting.costing.07",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "An item's costing method changes from FIFO to Average. What changes about the job's WIP postings?",
    options: [
      { id: "a", text: "WIP is no longer tracked for that item" },
      {
        id: "b",
        text: "Only the amount of the consumption entry — the shape, cost in from inventory and out to finished goods, is unchanged"
      },
      { id: "c", text: "Consumption is booked to variance instead of WIP" },
      {
        id: "d",
        text: "The item is received at standard and a variance is booked"
      }
    ],
    answer: "b",
    explanation:
      "The costing method decides which cost a consumption picks up — walking layers for FIFO or LIFO, the running unit cost for Average — never whether WIP is tracked.",
    docsUrl: G_COST
  },
  {
    slug: "accounting.costing.08",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "remember",
    kind: "single",
    prompt: "What is an open cost layer in Carbon?",
    options: [
      { id: "a", text: "A row in a dedicated cost-layer table" },
      {
        id: "b",
        text: "A cost-ledger row that still has remaining quantity on it"
      },
      { id: "c", text: "An unposted journal line awaiting valuation" },
      { id: "d", text: "A reservation held against a bin" }
    ],
    answer: "b",
    explanation:
      "There is no separate cost-layer table. Each inbound cost-ledger entry opens a layer, and FIFO or LIFO consumption walks those rows by date.",
    docsUrl: G_COST
  },
  {
    slug: "accounting.costing.09",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "analyze",
    kind: "single",
    prompt: "A tracked part on a job is scrapped. What happens to its cost?",
    options: [
      { id: "a", text: "It stays in WIP and sweeps to variance at close" },
      {
        id: "b",
        text: "It is debited to a dedicated scrap account and credited out of WIP, tagged with reason, work center, and operator"
      },
      {
        id: "c",
        text: "It stays in WIP so the job's true cost remains visible"
      },
      { id: "d", text: "It is debited straight to cost of goods sold" }
    ],
    answer: "b",
    explanation:
      "Ruined value leaves the job rather than riding along to close, and the scrap reopens the routing so a replacement gets built.",
    docsUrl: G_COST
  },
  {
    slug: "accounting.costing.10",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "apply",
    kind: "single",
    prompt:
      "A job estimated at 4,000 actually accumulated 4,620 in WIP. At what value do the finished goods enter inventory?",
    options: [
      { id: "a", text: "4,000, with a 620 variance booked at completion" },
      {
        id: "b",
        text: "4,620 — the job's actual accumulated WIP cost, with no variance at finish"
      },
      { id: "c", text: "The item's standard cost, whatever that is" },
      { id: "d", text: "4,620 less any scrap already relieved" }
    ],
    answer: "b",
    explanation:
      "Carbon does not receive finished goods at standard and book a variance. The finished unit's cost is simply the sum of what the job actually spent.",
    docsUrl: G_FINISH
  },
  {
    slug: "accounting.costing.11",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "analyze",
    kind: "single",
    prompt: "Why is no variance posted when a job completes?",
    options: [
      { id: "a", text: "Variance is deferred until the unit is sold" },
      {
        id: "b",
        text: "Completion moves the whole WIP balance into inventory one-for-one — equal debit and credit"
      },
      { id: "c", text: "Carbon does not track manufacturing variance at all" },
      {
        id: "d",
        text: "Variance is only posted when the costing method is Standard"
      }
    ],
    answer: "b",
    explanation:
      "There is nothing to be different from, because the receipt is valued at whatever went in. The item's costing method only decides how that cost is carried forward onto the part.",
    docsUrl: G_FINISH
  },
  {
    slug: "accounting.costing.12",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A make-to-order job finishes. How do those goods reach the customer's shipment?",
    options: [
      {
        id: "a",
        text: "They ship straight off the job with no inventory posting"
      },
      {
        id: "b",
        text: "The job receives into inventory first, and the sales order then ships from inventory — two separate postings"
      },
      { id: "c", text: "WIP is relieved directly to cost of goods sold" },
      { id: "d", text: "The job's WIP transfers onto the sales order line" }
    ],
    answer: "b",
    explanation:
      "A make-to-order job's costing is identical to a stock job's. There is no path that ships finished goods off a job, which keeps cost in one place and makes the sale a clean separate event.",
    docsUrl: G_FINISH
  },
  {
    slug: "accounting.costing.13",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "apply",
    kind: "single",
    prompt: "The shipment for a made-to-order unit posts. Which accounts move?",
    options: [
      { id: "a", text: "Debit cost of goods sold, credit work-in-process" },
      {
        id: "b",
        text: "Debit cost of goods sold, credit inventory — priced from the inventory cost layers"
      },
      { id: "c", text: "Debit inventory, credit work-in-process" },
      { id: "d", text: "Debit cost of goods sold, credit production variance" }
    ],
    answer: "b",
    explanation:
      "By the time a unit is sold, its WIP was relieved at completion. COGS is always drawn from the inventory layer, so margin reflects the real landed cost of that stock.",
    docsUrl: G_FINISH
  },
  {
    slug: "accounting.costing.14",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A completed job still carries 8.40 in WIP because a labor event posted late. What does closing it do?",
    options: [
      { id: "a", text: "Reopens the job so the cost can be absorbed properly" },
      {
        id: "b",
        text: "Debits Production Variance and credits WIP, tagged Job Close — the one place a job's variance lands"
      },
      { id: "c", text: "Adds the 8.40 to the finished item's inventory cost" },
      { id: "d", text: "Writes it straight off to cost of goods sold" }
    ],
    answer: "b",
    explanation:
      "No standard-cost variance is booked along the way. The only variance Carbon posts for a job is whatever WIP is left over at close, which leaves the job provably at zero.",
    docsUrl: G_FINISH
  },
  {
    slug: "accounting.costing.15",
    unitSlug: "job-costing",
    topic: "costing",
    bloom: "remember",
    kind: "single",
    prompt: "Completing a job backflushes which material?",
    options: [
      {
        id: "a",
        text: "Everything the method called for that was not already issued"
      },
      {
        id: "b",
        text: "Only untracked material — serial- and batch-tracked material has to be scanned in on the floor"
      },
      { id: "c", text: "Only the material on the final operation" },
      { id: "d", text: "None — backflushing happens at close, not completion" }
    ],
    answer: "b",
    explanation:
      "Tracked material is never backflushed, because a serial or batch has to be identified by the person who consumed it. Only untracked material still owed is swept at completion.",
    docsUrl: G_FINISH
  }
];
