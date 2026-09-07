/**
 * Carbon Fundamentals — question bank. SERVER ONLY.
 *
 * Answers and explanations must never reach the browser, which is why this file
 * is `.server.ts` and is never re-exported from the module barrel.
 *
 * Every question is grounded in a docs page and every distractor is a
 * misconception people actually hold — "the method type lives on the BoM line",
 * "an employee type change updates existing staff". Filler options teach
 * nothing and make a scored quiz meaningless.
 */

import type { LearnQuestion } from "../types";

const D = "https://docs.carbon.ms";

export const questions: LearnQuestion[] = [
  // ------------------------------------------------------------ overview (12)
  {
    slug: "fundamentals.what-carbon-is.01",
    unitSlug: "what-carbon-is",
    topic: "overview",
    bloom: "remember",
    kind: "single",
    prompt: "Carbon ships two applications. What does each one cover?",
    options: [
      { id: "a", text: "The ERP runs the office; the MES runs the shop floor" },
      {
        id: "b",
        text: "The ERP runs accounting only; the MES runs everything else"
      },
      {
        id: "c",
        text: "The ERP is for managers; the MES is a read-only dashboard"
      },
      { id: "d", text: "They are the same app under two names" }
    ],
    answer: "a",
    explanation:
      "Carbon is a manufacturing system with two front doors: the ERP for office work (quotes, orders, purchasing, accounting) and the MES for the floor (clocking on, reporting quantities, issuing material).",
    docsUrl: `${D}/docs`
  },
  {
    slug: "fundamentals.what-carbon-is.02",
    unitSlug: "what-carbon-is",
    topic: "overview",
    bloom: "apply",
    kind: "single",
    prompt:
      "An operator needs to report 12 good parts and 1 scrap against an operation they are running. Where do they do it?",
    options: [
      { id: "a", text: "In the ERP, on the job's Materials tab" },
      {
        id: "b",
        text: "In the MES, on the job operation they are clocked on to"
      },
      { id: "c", text: "In the ERP, by editing the sales order line" },
      {
        id: "d",
        text: "Anywhere — production reporting is only an accounting entry"
      }
    ],
    answer: "b",
    explanation:
      "Production quantities are reported on the floor, in the MES, against the operation the operator is clocked on to. The ERP reads the result; it is not where the floor reports.",
    docsUrl: `${D}/docs`
  },
  {
    slug: "fundamentals.what-carbon-is.03",
    unitSlug: "what-carbon-is",
    topic: "overview",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A customer order arrives for 90 units of a part you manufacture. In Carbon's make-to-order spine, what is created to actually build them?",
    options: [
      { id: "a", text: "A purchase order to your own company" },
      {
        id: "b",
        text: "A job, which carries its own copy of the part's method"
      },
      {
        id: "c",
        text: "A receipt, which is posted when the parts are finished"
      },
      { id: "d", text: "Nothing — the sales order is built directly" }
    ],
    answer: "b",
    explanation:
      "Demand becomes a job, and the job gets its own copy of the part's method (Get Method) so edits during the build never rewrite the part master.",
    docsUrl: `${D}/guides/order`
  },
  {
    slug: "fundamentals.what-carbon-is.04",
    unitSlug: "what-carbon-is",
    topic: "overview",
    bloom: "apply",
    kind: "single",
    prompt:
      "Someone asks 'what exact fields does a purchase order line carry?'. Which part of the documentation answers that fastest?",
    options: [
      {
        id: "a",
        text: "A Guide chapter, because guides walk through a real order"
      },
      {
        id: "b",
        text: "The Reference section, which has one scannable page per entity"
      },
      { id: "c", text: "The API reference, because it is generated" },
      { id: "d", text: "The glossary" }
    ],
    answer: "b",
    explanation:
      "Guides are narrative tours; Reference is one page per entity with field tables and status lists. Field-level questions are Reference questions.",
    docsUrl: `${D}/docs`
  },
  {
    slug: "fundamentals.what-carbon-is.05",
    unitSlug: "what-carbon-is",
    topic: "overview",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Why does Carbon copy a part's method onto the job instead of pointing the job at the part's method?",
    options: [
      {
        id: "a",
        text: "So edits made while building do not silently rewrite the part master or shift jobs already running"
      },
      { id: "b", text: "To save database space" },
      { id: "c", text: "Because parts may not have methods" },
      { id: "d", text: "So two jobs can never build the same part" }
    ],
    answer: "a",
    explanation:
      "Get Method copies the recipe onto the job. The job edits its copy; a proven change can be pushed back up deliberately, but nothing changes under a running build by accident.",
    docsUrl: `${D}/docs/reference/methods`
  },
  {
    slug: "fundamentals.what-carbon-is.06",
    unitSlug: "what-carbon-is",
    topic: "overview",
    bloom: "apply",
    kind: "single",
    prompt:
      "A planner wants to know whether a part will be bought or made when demand appears. Which field answers that?",
    options: [
      { id: "a", text: "The item's tracking type" },
      { id: "b", text: "The item's replenishment system" },
      { id: "c", text: "The item's unit of measure" },
      { id: "d", text: "The item's costing method" }
    ],
    answer: "b",
    explanation:
      "Replenishment system (Buy, Make, or Buy and Make) is what planning reads to decide between raising a job and raising a purchase order.",
    docsUrl: `${D}/docs/reference/items`
  },
  {
    slug: "fundamentals.what-carbon-is.07",
    unitSlug: "what-carbon-is",
    topic: "overview",
    bloom: "remember",
    kind: "single",
    prompt: "What does a sales order in Carbon represent?",
    options: [
      { id: "a", text: "A quotation sent to a customer" },
      {
        id: "b",
        text: "A confirmed commitment to deliver goods to a customer"
      },
      { id: "c", text: "An internal build instruction" },
      { id: "d", text: "A supplier's promise to deliver to you" }
    ],
    answer: "b",
    explanation:
      "A quote is an offer; a sales order is the accepted commitment, and it is the demand the rest of the system plans against.",
    docsUrl: `${D}/guides/order`
  },
  {
    slug: "fundamentals.what-carbon-is.08",
    unitSlug: "what-carbon-is",
    topic: "overview",
    bloom: "analyze",
    kind: "multi",
    prompt:
      "Which of these are true of the relationship between a sales order and the jobs that fulfil it? (Choose all that apply.)",
    options: [
      {
        id: "a",
        text: "One sales order line can be batched into one or more jobs"
      },
      { id: "b", text: "A job carries its own copy of the method" },
      { id: "c", text: "Creating a job deletes the sales order line" },
      { id: "d", text: "A job can be released or left to planning" }
    ],
    answer: ["a", "b", "d"],
    explanation:
      "Order lines are batched into jobs, each job copies the method, and a job is either released now or left for planning. The order line survives — it is what the job is fulfilling.",
    docsUrl: `${D}/guides/order`
  },
  {
    slug: "fundamentals.what-carbon-is.09",
    unitSlug: "what-carbon-is",
    topic: "overview",
    bloom: "apply",
    kind: "single",
    prompt:
      "A new hire says 'Carbon is our accounting system'. What is the most accurate correction?",
    options: [
      {
        id: "a",
        text: "Accounting is one module; Carbon also runs sales, purchasing, inventory, production, and quality"
      },
      {
        id: "b",
        text: "Correct — everything else is an export from accounting"
      },
      { id: "c", text: "Carbon has no accounting at all" },
      { id: "d", text: "Accounting lives only in the MES" }
    ],
    answer: "a",
    explanation:
      "Carbon is an ERP/MES/QMS. Accounting is one module among many, and it is fed by the operational documents rather than being the source of them.",
    docsUrl: `${D}/docs`
  },
  {
    slug: "fundamentals.what-carbon-is.10",
    unitSlug: "what-carbon-is",
    topic: "overview",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A part is manufactured for one parent assembly but pulled from stock for another. Is that possible in Carbon?",
    options: [
      {
        id: "a",
        text: "No — a part has one method type and it applies everywhere"
      },
      {
        id: "b",
        text: "Yes — method type answers how it gets into its parent, and replenishment system answers how it is replenished overall"
      },
      { id: "c", text: "Only if the part has two item records" },
      { id: "d", text: "Only for Service items" }
    ],
    answer: "b",
    explanation:
      "The docs keep these two questions apart on purpose: a part can be made for one parent and pulled for another, while replenishment system is what planning reads.",
    docsUrl: `${D}/docs/reference/methods`
  },
  {
    slug: "fundamentals.what-carbon-is.11",
    unitSlug: "what-carbon-is",
    topic: "overview",
    bloom: "remember",
    kind: "single",
    prompt: "Which document records goods physically arriving from a supplier?",
    options: [
      { id: "a", text: "A purchase invoice" },
      { id: "b", text: "A receipt" },
      { id: "c", text: "A shipment" },
      { id: "d", text: "A supplier quote" }
    ],
    answer: "b",
    explanation:
      "A receipt records arrival and, when posted, increases stock. The supplier's bill is a separate document (the purchase invoice).",
    docsUrl: `${D}/docs/reference/receipts`
  },
  {
    slug: "fundamentals.what-carbon-is.12",
    unitSlug: "what-carbon-is",
    topic: "overview",
    bloom: "apply",
    kind: "single",
    prompt:
      "You want to follow one order end to end — demand, build, floor, ship — reading rather than clicking. Where should you start?",
    options: [
      {
        id: "a",
        text: "The Guides, which are narrative tours anchored on one running example"
      },
      { id: "b", text: "The glossary" },
      { id: "c", text: "The API reference" },
      { id: "d", text: "The Reference entity pages, in alphabetical order" }
    ],
    answer: "a",
    explanation:
      "Guides are the narrative surface: each flow follows one real order through the system. Reference is for looking a thing up once you know what it is called.",
    docsUrl: `${D}/guides/order`
  },

  // --------------------------------------------------------------- items (15)
  {
    slug: "fundamentals.items-and-methods.01",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "remember",
    kind: "single",
    prompt: "What is an item in Carbon?",
    options: [
      { id: "a", text: "A line on a sales order" },
      {
        id: "b",
        text: "The master record for anything Carbon tracks — a part, material, tool, or consumable"
      },
      { id: "c", text: "A physical unit of stock in a bin" },
      { id: "d", text: "A supplier's catalogue entry" }
    ],
    answer: "b",
    explanation:
      "Orders, methods, jobs, and inventory all point back to the item. It is the master record, not an instance of stock.",
    docsUrl: `${D}/docs/reference/items`
  },
  {
    slug: "fundamentals.items-and-methods.02",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "apply",
    kind: "single",
    prompt:
      "A drawing change is released for a bracket. Jobs are already running against the old design. What does Carbon do?",
    options: [
      { id: "a", text: "Rewrites the item so every job picks up the change" },
      {
        id: "b",
        text: "Creates a new revision as its own item record, so jobs built against the earlier revision keep their history"
      },
      { id: "c", text: "Blocks the change until all jobs are closed" },
      { id: "d", text: "Duplicates the part number under a new id" }
    ],
    answer: "b",
    explanation:
      "Each revision is its own item record sharing the part number. A design change creates a new revision rather than rewriting the old one.",
    docsUrl: `${D}/docs/reference/items`
  },
  {
    slug: "fundamentals.items-and-methods.03",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Where does an item's costing method (Standard, Average, FIFO, LIFO) live?",
    options: [
      { id: "a", text: "On the item record itself" },
      { id: "b", text: "On the item's cost record, not the item" },
      { id: "c", text: "On each purchase order line" },
      { id: "d", text: "On the company settings, for all items at once" }
    ],
    answer: "b",
    explanation:
      "The costing method lives on the cost record and decides how consumption is valued. Looking for it on the item itself is a common wrong turn.",
    docsUrl: `${D}/docs/reference/items`
  },
  {
    slug: "fundamentals.items-and-methods.04",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "apply",
    kind: "single",
    prompt:
      "You need each individual unit of a part to carry its own record through the whole system. Which tracking type?",
    options: [
      { id: "a", text: "Inventory" },
      { id: "b", text: "Batch" },
      { id: "c", text: "Serial" },
      { id: "d", text: "Non-Inventory" }
    ],
    answer: "c",
    explanation:
      "Serial keeps one record per unit. Batch is lot-level with its own batch numbers and dates; Inventory is plain quantity tracking.",
    docsUrl: `${D}/docs/reference/items`
  },
  {
    slug: "fundamentals.items-and-methods.05",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "apply",
    kind: "single",
    prompt:
      "Which tracking type means the item is not counted as stock at all?",
    options: [
      { id: "a", text: "Non-Inventory" },
      { id: "b", text: "Inventory" },
      { id: "c", text: "Batch" },
      { id: "d", text: "Serial" }
    ],
    answer: "a",
    explanation:
      "Non-Inventory items are not quantity-tracked. Everything else — Inventory, Serial, Batch — counts stock at some granularity.",
    docsUrl: `${D}/docs/reference/items`
  },
  {
    slug: "fundamentals.items-and-methods.06",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A colleague sets a bill-of-materials line to 'Pull from Inventory' and is surprised the change appears on every other method that uses the part. Why did that happen?",
    options: [
      { id: "a", text: "A bug — method type is per line" },
      {
        id: "b",
        text: "Method type lives on the item, not the BoM line, so it cascades to every draft method that references the part"
      },
      { id: "c", text: "Because the part is serial-tracked" },
      { id: "d", text: "Because the method was Active" }
    ],
    answer: "b",
    explanation:
      "The method type lives on the item; every BoM that uses it mirrors it. The cascade reaches draft methods only — active and archived methods stay frozen.",
    docsUrl: `${D}/docs/reference/methods`
  },
  {
    slug: "fundamentals.items-and-methods.07",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You change a part's method type. An Active method that uses the part does not pick up the change. Is that correct behaviour?",
    options: [
      { id: "a", text: "No — it should cascade everywhere immediately" },
      {
        id: "b",
        text: "Yes — the cascade reaches draft methods only; active and archived methods stay frozen"
      },
      { id: "c", text: "Yes, but only because the part is purchased" },
      { id: "d", text: "No — Active methods are the only ones that update" }
    ],
    answer: "b",
    explanation:
      "Freezing Active methods is deliberate: jobs already running against them must not shift mid-build.",
    docsUrl: `${D}/docs/reference/methods`
  },
  {
    slug: "fundamentals.items-and-methods.08",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A group of fasteners always goes into the parent assembly together and is never built as a separate thing. Subassembly or kit?",
    options: [
      { id: "a", text: "Subassembly — it gets its own job and routing" },
      {
        id: "b",
        text: "Kit — nothing separate is built and the components are issued into the parent job"
      },
      { id: "c", text: "Neither; it must be one purchased item" },
      { id: "d", text: "Either — they behave identically" }
    ],
    answer: "b",
    explanation:
      "A kit builds nothing separately: its components are issued together into the parent job. A subassembly is genuinely manufactured and gets its own job and routing.",
    docsUrl: `${D}/docs/reference/methods`
  },
  {
    slug: "fundamentals.items-and-methods.09",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "remember",
    kind: "single",
    prompt: "What are the three method types?",
    options: [
      { id: "a", text: "Buy, Make, Buy and Make" },
      {
        id: "b",
        text: "Make to Order, Purchase to Order, Pull from Inventory"
      },
      { id: "c", text: "Draft, Active, Archived" },
      { id: "d", text: "Standard, Average, FIFO" }
    ],
    answer: "b",
    explanation:
      "Make to Order, Purchase to Order, and Pull from Inventory are the method types. Buy/Make/Buy and Make is the replenishment system — a different question.",
    docsUrl: `${D}/docs/reference/methods`
  },
  {
    slug: "fundamentals.items-and-methods.10",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "apply",
    kind: "single",
    prompt:
      "Creating a job for a part fails with 'Method tree not found'. What is the most likely cause?",
    options: [
      { id: "a", text: "The item has no Active make method to copy" },
      { id: "b", text: "The item is serial tracked" },
      { id: "c", text: "The sales order is not released" },
      { id: "d", text: "The part has more than one revision" }
    ],
    answer: "a",
    explanation:
      "Get Method copies an Active method onto the job. With only drafts (or nothing), there is no tree to copy — activate a version and retry.",
    docsUrl: `${D}/docs/reference/methods`
  },
  {
    slug: "fundamentals.items-and-methods.11",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "remember",
    kind: "single",
    prompt: "Which method version states are editable?",
    options: [
      { id: "a", text: "Draft only" },
      { id: "b", text: "Draft and Active" },
      { id: "c", text: "Active only" },
      { id: "d", text: "All three, including Archived" }
    ],
    answer: "a",
    explanation:
      "Only a Draft is editable. Active is frozen so running jobs do not shift, and Archived is history.",
    docsUrl: `${D}/docs/reference/methods`
  },
  {
    slug: "fundamentals.items-and-methods.12",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which two things make up a part's manufacturing method? (Choose all that apply.)",
    options: [
      { id: "a", text: "Method materials — its bill of materials" },
      { id: "b", text: "Method operations — its routing" },
      { id: "c", text: "Its supplier price breaks" },
      { id: "d", text: "Its costing method" }
    ],
    answer: ["a", "b"],
    explanation:
      "A method is the recipe: what goes in (materials) and what is done to it (operations). Pricing and costing live elsewhere.",
    docsUrl: `${D}/docs/reference/methods`
  },
  {
    slug: "fundamentals.items-and-methods.13",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "apply",
    kind: "single",
    prompt:
      "An item's part number displays as `BRK-100.2`. What does the `.2` mean?",
    options: [
      { id: "a", text: "The second unit of measure" },
      {
        id: "b",
        text: "A non-zero revision — the readable id reads as `id.rev`"
      },
      { id: "c", text: "The quantity on hand" },
      { id: "d", text: "The second supplier" }
    ],
    answer: "b",
    explanation:
      "With a non-zero revision the readable id renders as `id.rev`, because each revision is its own item record sharing the part number.",
    docsUrl: `${D}/docs/reference/items`
  },
  {
    slug: "fundamentals.items-and-methods.14",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A BoM line is set to the same item as the parent being made and Carbon refuses it. What has gone wrong?",
    options: [
      { id: "a", text: "The item is inactive" },
      { id: "b", text: "A self-reference — an item cannot be added to itself" },
      { id: "c", text: "The method is Archived" },
      { id: "d", text: "The quantity is zero" }
    ],
    answer: "b",
    explanation:
      "A component line pointing at its own parent would be an infinite explosion, so Carbon rejects the self-reference outright.",
    docsUrl: `${D}/docs/reference/methods`
  },
  {
    slug: "fundamentals.items-and-methods.15",
    unitSlug: "items-and-methods",
    topic: "items",
    bloom: "apply",
    kind: "single",
    prompt: "Marking an item inactive has what effect?",
    options: [
      { id: "a", text: "It is deleted along with its history" },
      { id: "b", text: "It can no longer be used on new documents" },
      { id: "c", text: "Its stock is written off" },
      { id: "d", text: "Its open orders are cancelled" }
    ],
    answer: "b",
    explanation:
      "Active controls whether an item can be used on new documents. Existing documents and history are untouched.",
    docsUrl: `${D}/docs/reference/items`
  },

  // -------------------------------------------------------------- people (12)
  {
    slug: "fundamentals.company-and-people.01",
    unitSlug: "company-and-people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt: "A new buyer is joining. How do they get a Carbon account?",
    options: [
      { id: "a", text: "An admin sets a password for them and shares it" },
      {
        id: "b",
        text: "An admin invites them by email and they set up their own sign-in"
      },
      { id: "c", text: "They self-register on the login page" },
      { id: "d", text: "They are given a 4-digit PIN" }
    ],
    answer: "b",
    explanation:
      "You never create passwords for people. Adding an employee records an invite and emails a link they use to finish joining.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.company-and-people.02",
    unitSlug: "company-and-people",
    topic: "people",
    bloom: "remember",
    kind: "single",
    prompt:
      "An employee's invite has been sent but not yet accepted. What is their status?",
    options: [
      { id: "a", text: "Active" },
      { id: "b", text: "Invited" },
      { id: "c", text: "Inactive" },
      { id: "d", text: "Pending" }
    ],
    answer: "b",
    explanation:
      "Invited means the link is out but unaccepted — they cannot sign in yet. Active follows acceptance; Inactive is deactivated or revoked.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.company-and-people.03",
    unitSlug: "company-and-people",
    topic: "people",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You deactivate an employee who also works for another company in the group. What happens to the person?",
    options: [
      { id: "a", text: "The person record is deleted everywhere" },
      {
        id: "b",
        text: "They are removed from this company and their grants stripped, but the person may still belong to other companies"
      },
      { id: "c", text: "Their other companies are deactivated too" },
      { id: "d", text: "Nothing until they next sign in" }
    ],
    answer: "b",
    explanation:
      "Deactivating removes them from that company and strips those grants; it does not delete a person who may legitimately belong elsewhere.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.company-and-people.04",
    unitSlug: "company-and-people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt:
      "A machinist has no email address but needs to run work on a shared floor tablet. What do you set up?",
    options: [
      { id: "a", text: "A normal invited user with a shared mailbox" },
      { id: "b", text: "A console operator with a 4-digit PIN" },
      { id: "c", text: "An API key" },
      { id: "d", text: "Nothing — they use a supervisor's login" }
    ],
    answer: "b",
    explanation:
      "Console operators sign in to the MES with a 4-digit PIN on a shared station. Carbon creates a lightweight account and assigns the Console Operator type automatically.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.company-and-people.05",
    unitSlug: "company-and-people",
    topic: "people",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A PIN operator is promoted and now needs full ERP access. What is the correct move?",
    options: [
      { id: "a", text: "Delete the operator and invite a brand-new user" },
      {
        id: "b",
        text: "Convert the account — give it an email and a full employee type, keeping its floor history on one identity"
      },
      { id: "c", text: "Give them a second account and keep both" },
      { id: "d", text: "Raise their PIN to 6 digits" }
    ],
    answer: "b",
    explanation:
      "Carbon promotes the same person to a normal invited user without losing history. A fresh account would orphan their floor activity.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.company-and-people.06",
    unitSlug: "company-and-people",
    topic: "people",
    bloom: "remember",
    kind: "single",
    prompt: "How long is a shop-floor operator PIN?",
    options: [
      { id: "a", text: "4 digits" },
      { id: "b", text: "6 digits" },
      { id: "c", text: "8 characters, letters and numbers" },
      { id: "d", text: "Any length the admin chooses" }
    ],
    answer: "a",
    explanation:
      "Exactly four digits — creating or resetting an operator rejects anything else.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.company-and-people.07",
    unitSlug: "company-and-people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt:
      "The Operators screen is missing from Settings → Users. What is the most likely reason?",
    options: [
      { id: "a", text: "The company has no employees yet" },
      { id: "b", text: "Console mode is not enabled for the company" },
      { id: "c", text: "You lack the Sales module" },
      { id: "d", text: "The MES app is not deployed" }
    ],
    answer: "b",
    explanation:
      "That screen is visible only when console mode is enabled. Without it there is no place to add PIN operators — people are invited by email under Accounts instead.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.company-and-people.08",
    unitSlug: "company-and-people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt:
      "Where is a company-wide setting such as the base currency configured?",
    options: [
      { id: "a", text: "On each customer record" },
      { id: "b", text: "In company settings, on the company record" },
      { id: "c", text: "On the user's own account preferences" },
      { id: "d", text: "On each sales order" }
    ],
    answer: "b",
    explanation:
      "The company record carries company-wide defaults such as the base currency. Personal preferences (theme, language) live on the user's account instead.",
    docsUrl: `${D}/docs/reference/company-settings`
  },
  {
    slug: "fundamentals.company-and-people.09",
    unitSlug: "company-and-people",
    topic: "people",
    bloom: "analyze",
    kind: "single",
    prompt:
      "A user belongs to two companies and holds different permissions in each. Is that supported?",
    options: [
      { id: "a", text: "No — permissions are global to a person" },
      {
        id: "b",
        text: "Yes — each grant stores the companies it applies to, so one person can hold different permissions per company"
      },
      { id: "c", text: "Only for administrators" },
      { id: "d", text: "Only if the companies are in different groups" }
    ],
    answer: "b",
    explanation:
      "A grant is scoped to a company. In the UI you always edit permissions for the company you are currently in.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.company-and-people.10",
    unitSlug: "company-and-people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt:
      "Which of these is a personal setting rather than a company-wide one?",
    options: [
      { id: "a", text: "Base currency" },
      { id: "b", text: "Your theme and language" },
      { id: "c", text: "Company logos" },
      { id: "d", text: "Feature toggles" }
    ],
    answer: "b",
    explanation:
      "Theme and language are per-user account settings. Currency, logos, and feature toggles belong to the company.",
    docsUrl: `${D}/docs/reference/account`
  },
  {
    slug: "fundamentals.company-and-people.11",
    unitSlug: "company-and-people",
    topic: "people",
    bloom: "apply",
    kind: "single",
    prompt:
      "An outstanding invite was sent to the wrong address. What can you do from the accounts list?",
    options: [
      { id: "a", text: "Only wait for it to expire" },
      { id: "b", text: "Resend it, or revoke it entirely" },
      { id: "c", text: "Edit the email on the invite in place" },
      { id: "d", text: "Delete the company and start again" }
    ],
    answer: "b",
    explanation:
      "An invite is a real record: while outstanding you can resend the email or revoke it, both from the accounts list.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.company-and-people.12",
    unitSlug: "company-and-people",
    topic: "people",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Why does an invite carry a permission set before it is ever accepted?",
    options: [
      { id: "a", text: "So the invite email can list the permissions" },
      {
        id: "b",
        text: "So the person's grants are ready the moment they accept"
      },
      { id: "c", text: "Because permissions cannot be edited afterwards" },
      { id: "d", text: "It does not — permissions are assigned on first login" }
    ],
    answer: "b",
    explanation:
      "The invite is company-scoped and keyed by email, carrying the starting permission set so there is no gap between acceptance and access.",
    docsUrl: `${D}/docs/reference/permissions`
  },

  // --------------------------------------------------------- permissions (12)
  {
    slug: "fundamentals.permissions.01",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "remember",
    kind: "single",
    prompt: "How is a single Carbon permission written?",
    options: [
      { id: "a", text: "`<module>_<action>`, such as `sales_view`" },
      { id: "b", text: "`<action>:<module>`, such as `view:sales`" },
      { id: "c", text: "A role name, such as `Buyer`" },
      { id: "d", text: "A numeric level from 1 to 5" }
    ],
    answer: "a",
    explanation:
      "A grant is a module and an action: `sales_view`, `inventory_update`, `purchasing_create`. Nothing is implied and nothing is global.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.permissions.02",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "remember",
    kind: "single",
    prompt: "What are the four actions available on every module?",
    options: [
      { id: "a", text: "read, write, admin, owner" },
      { id: "b", text: "view, create, update, delete" },
      { id: "c", text: "view, edit, approve, post" },
      { id: "d", text: "list, detail, form, action" }
    ],
    answer: "b",
    explanation:
      "The actions are always view, create, update, and delete — the same four on every module, rendered as a checkbox per cell in one shared matrix.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.permissions.03",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "single",
    prompt:
      "A user signs in successfully but sees no modules at all. What is the explanation?",
    options: [
      { id: "a", text: "Their account is not verified" },
      {
        id: "b",
        text: "They hold no grants — a person with no grants can sign in and see nothing"
      },
      { id: "c", text: "Their company has no data" },
      { id: "d", text: "They need to be an admin to see anything" }
    ],
    answer: "b",
    explanation:
      "Permissions are explicit. Without a `<module>_view` grant the module's pages are invisible, so an ungranted user signs in to an empty app.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.permissions.04",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You edit the 'Buyer' employee type to add `inventory_update`. Existing Buyers do not get it. Why?",
    options: [
      { id: "a", text: "A caching bug" },
      {
        id: "b",
        text: "Editing a type changes the template for people assigned after the change; existing staff keep their grants"
      },
      { id: "c", text: "Because inventory is a protected module" },
      { id: "d", text: "Because they must sign out first" }
    ],
    answer: "b",
    explanation:
      "A type is a starting template, not a live link. To push a change to existing staff you use the bulk permission editor.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.permissions.05",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "analyze",
    kind: "single",
    prompt:
      "You must give twelve existing employees one extra module without disturbing anything else they hold. Which bulk mode?",
    options: [
      { id: "a", text: "Update — it replaces each user's set with the matrix" },
      {
        id: "b",
        text: "Add — it layers the selected grants on top, taking nothing away"
      },
      { id: "c", text: "Either; they behave the same" },
      { id: "d", text: "Neither; edit each person individually" }
    ],
    answer: "b",
    explanation:
      "Add layers grants on; Update overwrites wholesale. The two modes are 'give everyone these too' versus 'make everyone exactly this'.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.permissions.06",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "analyze",
    kind: "single",
    prompt:
      "Someone bypasses the UI and calls the API directly for records they have no grant for. What stops them?",
    options: [
      { id: "a", text: "Nothing — the UI is the only check" },
      {
        id: "b",
        text: "The database enforces the same grants through row-level security"
      },
      { id: "c", text: "A rate limiter" },
      { id: "d", text: "The request is logged but allowed" }
    ],
    answer: "b",
    explanation:
      "Carbon enforces grants in two places: the app hides screens, and the database enforces the same grants through RLS, which is what makes API keys safe on the same model.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.permissions.07",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "single",
    prompt:
      "You changed a user's permissions and they still see the old ones. What is the usual fix?",
    options: [
      { id: "a", text: "Re-apply the employee type" },
      {
        id: "b",
        text: "Have them sign out and back in — effective permissions are cached per user"
      },
      { id: "c", text: "Restart the company's database" },
      { id: "d", text: "Delete and re-invite them" }
    ],
    answer: "b",
    explanation:
      "Carbon caches effective permissions for speed and clears the cache on change, so it lands on the next request. A stale session is the usual culprit.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.permissions.08",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "remember",
    kind: "single",
    prompt: "Which two employee types are seeded and cannot be deleted?",
    options: [
      { id: "a", text: "Admin and Console Operator" },
      { id: "b", text: "Admin and Buyer" },
      { id: "c", text: "Owner and Guest" },
      { id: "d", text: "Manager and Operator" }
    ],
    answer: "a",
    explanation:
      "Admin (full access) and Console Operator (shop-floor PIN accounts) are seeded with a stable system type, so the label can be renamed without breaking internal lookups.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.permissions.09",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "single",
    prompt:
      "You switch a person's employee type from their own screen. What does Carbon do with their existing grants?",
    options: [
      {
        id: "a",
        text: "Silently overwrites them with the new type's template"
      },
      {
        id: "b",
        text: "Asks first whether to overwrite with the new template or keep what they have"
      },
      { id: "c", text: "Always keeps them, with no prompt" },
      { id: "d", text: "Clears them and leaves the person with nothing" }
    ],
    answer: "b",
    explanation:
      "Carbon asks rather than silently rewriting, because the type is a label plus a starting template and the person may hold deliberate overrides.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.permissions.10",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "analyze",
    kind: "single",
    prompt: 'What does the special company value `"0"` on a grant represent?',
    options: [
      { id: "a", text: "No companies — the grant is disabled" },
      { id: "b", text: "All companies — a true cross-company administrator" },
      { id: "c", text: "The first company created" },
      { id: "d", text: "A pending grant" }
    ],
    answer: "b",
    explanation:
      'Each grant stores the companies it applies to; `"0"` means all of them, which is how a cross-company administrator is represented.',
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.permissions.11",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "multi",
    prompt:
      "Which surfaces use the same module-action permission matrix? (Choose all that apply.)",
    options: [
      { id: "a", text: "The employee-type template" },
      { id: "b", text: "A single employee's overrides" },
      { id: "c", text: "An API key's scopes" },
      { id: "d", text: "The customer portal's login form" }
    ],
    answer: ["a", "b", "c"],
    explanation:
      "The employee type, per-person overrides, the bulk editor, and API key scopes all render the identical matrix, so the mental model is the same everywhere.",
    docsUrl: `${D}/docs/reference/permissions`
  },
  {
    slug: "fundamentals.permissions.12",
    unitSlug: "permissions",
    topic: "permissions",
    bloom: "apply",
    kind: "single",
    prompt:
      "A buyer must read inventory levels but never change them. Which grants?",
    options: [
      { id: "a", text: "`inventory_view` only" },
      { id: "b", text: "`inventory_view` and `inventory_update`" },
      { id: "c", text: "`inventory_update` only" },
      { id: "d", text: "No grant — read access is implied by any other module" }
    ],
    answer: "a",
    explanation:
      "View is read; update is edit. Nothing is implied, so read-only access is exactly the one view grant.",
    docsUrl: `${D}/docs/reference/permissions`
  },

  // ------------------------------------------------------------ glossary (9)
  {
    slug: "fundamentals.navigating-carbon.01",
    unitSlug: "navigating-carbon",
    topic: "glossary",
    bloom: "remember",
    kind: "single",
    prompt: "In Carbon's vocabulary, what is a 'method'?",
    options: [
      { id: "a", text: "A payment method on an invoice" },
      {
        id: "b",
        text: "A part's recipe — its bill of materials plus its routing"
      },
      { id: "c", text: "A shipping method" },
      { id: "d", text: "A costing rule" }
    ],
    answer: "b",
    explanation:
      "A manufacturing method is the recipe: method materials (the BoM) and method operations (the routing).",
    docsUrl: `${D}/docs/reference/methods`
  },
  {
    slug: "fundamentals.navigating-carbon.02",
    unitSlug: "navigating-carbon",
    topic: "glossary",
    bloom: "remember",
    kind: "single",
    prompt: "What is a 'job' in Carbon?",
    options: [
      { id: "a", text: "A scheduled background task" },
      {
        id: "b",
        text: "A work order that builds a quantity of an item, carrying its own copy of the method"
      },
      { id: "c", text: "A person's role" },
      { id: "d", text: "A customer order line" }
    ],
    answer: "b",
    explanation:
      "A job is the manufacturing work order. It gets its own copy of the part's method so the build can be adjusted without touching the master.",
    docsUrl: `${D}/guides/order`
  },
  {
    slug: "fundamentals.navigating-carbon.03",
    unitSlug: "navigating-carbon",
    topic: "glossary",
    bloom: "apply",
    kind: "single",
    prompt:
      "You meet an unfamiliar term in the documentation with a dotted underline. What does clicking it do?",
    options: [
      { id: "a", text: "Nothing — it is decorative" },
      {
        id: "b",
        text: "Shows its glossary definition, with an optional link to learn more"
      },
      { id: "c", text: "Opens the API reference" },
      { id: "d", text: "Files a documentation issue" }
    ],
    answer: "b",
    explanation:
      "Terms are glossary-linked inline: the definition appears in place so you never have to leave the page to understand a word.",
    docsUrl: `${D}/docs/glossary`
  },
  {
    slug: "fundamentals.navigating-carbon.04",
    unitSlug: "navigating-carbon",
    topic: "glossary",
    bloom: "remember",
    kind: "single",
    prompt: "What is a 'batch' (lot) in Carbon's tracking vocabulary?",
    options: [
      { id: "a", text: "A group of sales orders processed together" },
      {
        id: "b",
        text: "A lot-tracked quantity with its own batch number and dates"
      },
      { id: "c", text: "One unit with a unique serial" },
      { id: "d", text: "A scheduled import" }
    ],
    answer: "b",
    explanation:
      "Batch tracking is lot-level: a quantity sharing a batch number and dates. Serial tracking is one record per individual unit.",
    docsUrl: `${D}/docs/reference/items`
  },
  {
    slug: "fundamentals.navigating-carbon.05",
    unitSlug: "navigating-carbon",
    topic: "glossary",
    bloom: "apply",
    kind: "single",
    prompt: "What does 'readable id' mean, as opposed to the underlying id?",
    options: [
      {
        id: "a",
        text: "The human-facing number such as a part number or PO number"
      },
      { id: "b", text: "The database primary key" },
      { id: "c", text: "A barcode-only value" },
      { id: "d", text: "The customer's own reference" }
    ],
    answer: "a",
    explanation:
      "The readable id is what people say out loud — the part number, the PO number. The underlying id is an internal key you rarely see.",
    docsUrl: `${D}/docs/reference/items`
  },
  {
    slug: "fundamentals.navigating-carbon.06",
    unitSlug: "navigating-carbon",
    topic: "glossary",
    bloom: "remember",
    kind: "single",
    prompt: "What is a 'company group'?",
    options: [
      { id: "a", text: "A permission group of users" },
      {
        id: "b",
        text: "A set of companies under one owner sharing group-scoped configuration"
      },
      { id: "c", text: "A customer segment" },
      { id: "d", text: "A department" }
    ],
    answer: "b",
    explanation:
      "A company group spans several companies under one owner and shares group-scoped configuration such as the chart of accounts and currencies.",
    docsUrl: `${D}/docs/glossary`
  },
  {
    slug: "fundamentals.navigating-carbon.07",
    unitSlug: "navigating-carbon",
    topic: "glossary",
    bloom: "apply",
    kind: "single",
    prompt: "Where do you change your own notification preferences?",
    options: [
      { id: "a", text: "Company settings" },
      { id: "b", text: "Your account" },
      { id: "c", text: "The admin's user list" },
      { id: "d", text: "Each document you want notifications for" }
    ],
    answer: "b",
    explanation:
      "Notification preferences are personal and live on your own account, alongside profile, sign-in, theme, and language.",
    docsUrl: `${D}/docs/reference/account`
  },
  {
    slug: "fundamentals.navigating-carbon.08",
    unitSlug: "navigating-carbon",
    topic: "glossary",
    bloom: "apply",
    kind: "single",
    prompt:
      "In-app notifications arrive whether or not you opt in, but email and Slack are opt-in. Why would a product make in-app non-optional?",
    options: [
      {
        id: "a",
        text: "So a notification always has one reliable destination the user can find later"
      },
      { id: "b", text: "Because in-app messages are cheaper to send" },
      { id: "c", text: "Because email is deprecated" },
      { id: "d", text: "It is an oversight" }
    ],
    answer: "a",
    explanation:
      "In-app is the guaranteed channel, so nothing is silently lost when a user has turned every external channel off.",
    docsUrl: `${D}/docs/reference/account`
  },
  {
    slug: "fundamentals.navigating-carbon.09",
    unitSlug: "navigating-carbon",
    topic: "glossary",
    bloom: "remember",
    kind: "single",
    prompt: "What is a 'serial' in Carbon?",
    options: [
      { id: "a", text: "A sequence number on a document" },
      {
        id: "b",
        text: "A unique identity for one individual unit of a tracked item"
      },
      { id: "c", text: "The order lines appear in" },
      { id: "d", text: "A supplier's catalogue code" }
    ],
    answer: "b",
    explanation:
      "A serial identifies one physical unit. Serial-tracked items carry one record per unit through the whole system.",
    docsUrl: `${D}/docs/reference/items`
  }
];
