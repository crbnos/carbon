// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Priority sets: which Carbon features a company needs, and when. Every feature
// sits in one of four categories: 0 must be live before go-live, 1 in the first
// months, 2 later, 3 not now. A questionnaire moves features between them, and
// Carbon staff can override any feature by hand (logic/priority-set.ts).
//
// Generated from the priority-set markdown (feature catalogue, questionnaire and
// blank-start file) kept outside this repo; regenerate rather than hand-edit, so
// the two stay in step. Feature, question, option, section and system-row keys
// are stored with a company's answers: never rename or reuse one.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export type PriorityCategory = 0 | 1 | 2 | 3;

export const PRIORITY_CATEGORIES: readonly PriorityCategory[] = [0, 1, 2, 3];

export const PRIORITY_CATEGORY_NAME: Record<
  PriorityCategory,
  MessageDescriptor
> = {
  0: msg`Before go-live`,
  1: msg`First months`,
  2: msg`Later`,
  3: msg`Not now`
};

export type PriorityFeatureGroup =
  | "items"
  | "resources"
  | "purchasing"
  | "inventory"
  | "production"
  | "shopFloor"
  | "sales"
  | "quality"
  | "people"
  | "users"
  | "invoicing"
  | "accounting"
  | "documents"
  | "platform";

export const PRIORITY_FEATURE_GROUP_NAME: Record<
  PriorityFeatureGroup,
  MessageDescriptor
> = {
  items: msg`Items`,
  resources: msg`Resources`,
  purchasing: msg`Purchasing`,
  inventory: msg`Inventory`,
  production: msg`Production`,
  shopFloor: msg`Shop floor`,
  sales: msg`Sales`,
  quality: msg`Quality`,
  people: msg`People`,
  users: msg`Users`,
  invoicing: msg`Invoicing`,
  accounting: msg`Accounting`,
  documents: msg`Documents`,
  platform: msg`Platform`
};

export interface PriorityFeature {
  key: string; // stable, e.g. "sales.quotes"
  name: MessageDescriptor;
  group: PriorityFeatureGroup;
  defaultCategory: PriorityCategory;
  covers: MessageDescriptor;
  // Features this one needs. Each entry is one requirement; an entry with
  // several keys is met by any of them ("parts or materials").
  needs: string[][];
}

export const PRIORITY_FEATURES: PriorityFeature[] = [
  {
    key: "items.parts",
    name: msg`Parts`,
    group: "items",
    defaultCategory: 0,
    covers: msg`item master for made and bought parts: replenishment (Buy, Make, Buy and Make), tracking type, unit of measure, costing, planning, purchasing and sales settings per item`,
    needs: []
  },
  {
    key: "items.materials",
    name: msg`Materials`,
    group: "items",
    defaultCategory: 0,
    covers: msg`raw materials described by substance, form, type, grade, dimension and finish, with IDs that can be generated from those properties`,
    needs: []
  },
  {
    key: "items.methods",
    name: msg`Bills of material and routings`,
    group: "items",
    defaultCategory: 0,
    covers: msg`versioned make method per item (Draft, Active, Archived): bill of materials lines and routing operations on processes`,
    needs: [["items.parts"], ["items.materials"], ["resources.processes"]]
  },
  {
    key: "items.consumables",
    name: msg`Consumables`,
    group: "items",
    defaultCategory: 1,
    covers: msg`stocked supplies that are bought and used up, with purchasing, inventory and planning settings and no make method`,
    needs: []
  },
  {
    key: "items.supplier-parts",
    name: msg`Supplier part numbers and prices`,
    group: "items",
    defaultCategory: 1,
    covers: msg`per supplier and item: supplier part number, purchase unit and conversion factor, minimum order quantity, order multiple, currency, unit price and quantity price breaks; lead time is set per item, not per supplier`,
    needs: [
      ["purchasing.suppliers"],
      ["items.parts", "items.materials", "items.consumables"]
    ]
  },
  {
    key: "items.tools",
    name: msg`Tools`,
    group: "items",
    defaultCategory: 2,
    covers: msg`tool items, stocked like parts, attached to routing operations and steps; a tool can have its own make method`,
    needs: []
  },
  {
    key: "items.services",
    name: msg`Services`,
    group: "items",
    defaultCategory: 2,
    covers: msg`non-inventory service items, bought or made, used on sales, purchase and contract lines`,
    needs: []
  },
  {
    key: "items.change-control",
    name: msg`Revisions and change notices`,
    group: "items",
    defaultCategory: 2,
    covers: msg`item revisions as sibling items with the same number, and change notices: affected parts, a change type per part (Version, Revision, Replacement Part, New Part), draft BOM and routing edits, release with supersession`,
    needs: [["items.parts"]]
  },
  {
    key: "items.configurator",
    name: msg`Product configurator`,
    group: "items",
    defaultCategory: 2,
    covers: msg`configuration parameters on a part (text, numeric, boolean, list, date), code rules that set BOM and routing values when the method is built, configured on quote and sales order lines and priced by configuration pricing rules`,
    needs: [
      ["items.parts"],
      ["items.methods"],
      ["sales.quotes", "sales.orders"]
    ]
  },
  {
    key: "resources.locations",
    name: msg`Locations`,
    group: "resources",
    defaultCategory: 0,
    covers: msg`physical sites with address and timezone; inventory, jobs and employees are scoped to a location`,
    needs: []
  },
  {
    key: "resources.processes",
    name: msg`Processes`,
    group: "resources",
    defaultCategory: 0,
    covers: msg`types of work that routing operations reference, with batchable and requires-ability flags`,
    needs: []
  },
  {
    key: "resources.work-centers",
    name: msg`Work centers`,
    group: "resources",
    defaultCategory: 0,
    covers: msg`production stations at a location, linked to the processes they run, with rates, operating shifts or lights-out hours`,
    needs: [["resources.locations"], ["resources.processes"]]
  },
  {
    key: "resources.maintenance",
    name: msg`Maintenance`,
    group: "resources",
    defaultCategory: 2,
    covers: msg`reactive and scheduled maintenance dispatches on work centers, failure modes and spare parts; an open dispatch can take a work center out of the schedule; dispatches are worked in the shop floor app`,
    needs: [["resources.work-centers"]]
  },
  {
    key: "purchasing.suppliers",
    name: msg`Suppliers`,
    group: "purchasing",
    defaultCategory: 0,
    covers: msg`suppliers with contacts, locations, types, statuses, payment terms and the processes they offer`,
    needs: []
  },
  {
    key: "purchasing.orders",
    name: msg`Purchase orders`,
    group: "purchasing",
    defaultCategory: 0,
    covers: msg`purchase orders from draft through finalize (approval, PDF, email) to receive and invoice, with in-place revisions`,
    needs: [
      ["purchasing.suppliers"],
      ["items.materials", "items.parts"],
      ["resources.locations"]
    ]
  },
  {
    key: "purchasing.outside-processing",
    name: msg`Outside processing`,
    group: "purchasing",
    defaultCategory: 2,
    covers: msg`routing operations subcontracted to a supplier process; releasing the job raises the purchase order for that operation`,
    needs: [
      ["purchasing.suppliers"],
      ["resources.processes"],
      ["production.jobs"],
      ["purchasing.orders"]
    ]
  },
  {
    key: "purchasing.supplier-quotes",
    name: msg`Supplier quotes and RFQs`,
    group: "purchasing",
    defaultCategory: 2,
    covers: msg`requests for quote sent to several suppliers through a share page, supplier quotes with price breaks, conversion to purchase orders`,
    needs: [["purchasing.suppliers"]]
  },
  {
    key: "purchasing.returns",
    name: msg`Purchase returns`,
    group: "purchasing",
    defaultCategory: 2,
    covers: msg`supplier return orders, optionally against a purchase order, shipped back out of stock`,
    needs: [["purchasing.suppliers"], ["inventory.stock"]]
  },
  {
    key: "inventory.receipts",
    name: msg`Receipts`,
    group: "inventory",
    defaultCategory: 0,
    covers: msg`receiving purchase order lines into stock; posting writes the item ledger and creates serial and batch records; also receives returns, transfers and rental units`,
    needs: [["purchasing.orders"]]
  },
  {
    key: "inventory.shipments",
    name: msg`Shipments`,
    group: "inventory",
    defaultCategory: 0,
    covers: msg`shipping sales order lines from stock with a packing slip; posting writes the item ledger; also ships supplier returns and rental units`,
    needs: [["sales.orders"], ["resources.locations"]]
  },
  {
    key: "inventory.stock",
    name: msg`Stock on hand and adjustments`,
    group: "inventory",
    defaultCategory: 0,
    covers: msg`on-hand quantities by location and storage unit, stock movements and manual adjustments`,
    needs: [["resources.locations"]]
  },
  {
    key: "inventory.storage-units",
    name: msg`Storage units`,
    group: "inventory",
    defaultCategory: 1,
    covers: msg`nested bins within a location with storage types, transfers between bins, default pick bins and lineside bins on work centers; storage rules are Business plan`,
    needs: [["resources.locations"]]
  },
  {
    key: "inventory.traceability",
    name: msg`Serial and batch tracking`,
    group: "inventory",
    defaultCategory: 1,
    covers: msg`serial or batch tracking set per item; tracked units carry status, expiry and batch properties; per-item serial number sequences; a traceability graph from material lot to finished unit`,
    needs: [["items.parts", "items.materials"], ["inventory.stock"]]
  },
  {
    key: "inventory.picking-lists",
    name: msg`Picking lists`,
    group: "inventory",
    defaultCategory: 2,
    covers: msg`picking job materials from storage to the operation's lineside bin, in FEFO or FIFO order, in the ERP or the shop floor app`,
    needs: [["production.jobs"], ["inventory.storage-units"]]
  },
  {
    key: "inventory.counts",
    name: msg`Inventory counts`,
    group: "inventory",
    defaultCategory: 2,
    covers: msg`physical and cycle counts that snapshot on-hand, record counted quantities and post the differences`,
    needs: [["inventory.stock"]]
  },
  {
    key: "inventory.transfers",
    name: msg`Transfers between locations`,
    group: "inventory",
    defaultCategory: 3,
    covers: msg`warehouse transfers that ship stock from one location and receive it at another`,
    needs: [["resources.locations"], ["inventory.stock"]]
  },
  {
    key: "production.jobs",
    name: msg`Jobs`,
    group: "production",
    defaultCategory: 0,
    covers: msg`production orders built from the item's make method; release, material issue, operation progress and completion to inventory`,
    needs: [["items.methods"], ["resources.locations"]]
  },
  {
    key: "production.mrp",
    name: msg`MRP planning`,
    group: "production",
    defaultCategory: 1,
    covers: msg`material planning across sales orders, job materials and forecasts against stock and open supply; production and purchasing planning grids create jobs and purchase orders; reorder policies per item and location; demand forecasts are Business plan`,
    needs: [["production.jobs"], ["purchasing.orders"]]
  },
  {
    key: "production.scheduling",
    name: msg`Scheduling`,
    group: "production",
    defaultCategory: 1,
    covers: msg`finite forward scheduling per location on work-center hours, shifts and qualified people; operation, date and people priority boards`,
    needs: [["production.jobs"], ["resources.work-centers"]]
  },
  {
    key: "production.work-instructions",
    name: msg`Work instructions and procedures`,
    group: "production",
    defaultCategory: 2,
    covers: msg`steps, parameters and tools on routing operations; versioned procedures per process; 3D assembly instructions from a CAD model`,
    needs: [["items.methods"], ["resources.processes"]]
  },
  {
    key: "production.make-to-asset",
    name: msg`Make to asset`,
    group: "production",
    defaultCategory: 3,
    covers: msg`a job linked to a fixed asset class completes into one fixed asset per serialized unit instead of stock`,
    needs: [
      ["production.jobs"],
      ["accounting.fixed-assets"],
      ["inventory.traceability"]
    ]
  },
  {
    key: "mes.operations",
    name: msg`Running operations in the shop floor app`,
    group: "shopFloor",
    defaultCategory: 0,
    covers: msg`the shop floor app: operations by work center at the user's location; start, pause and finish; record production, scrap and rework; issue materials; operation steps and inspections`,
    needs: [["production.jobs"], ["resources.work-centers"], ["users.accounts"]]
  },
  {
    key: "mes.time-cards",
    name: msg`Time cards`,
    group: "shopFloor",
    defaultCategory: 2,
    covers: msg`clock in and out in the shop floor app, with timecard review in the ERP; switched on in settings`,
    needs: [["people.employees"]]
  },
  {
    key: "sales.customers",
    name: msg`Customers`,
    group: "sales",
    defaultCategory: 0,
    covers: msg`customers with contacts, locations, types, statuses, payment terms, currency and price overrides`,
    needs: []
  },
  {
    key: "sales.orders",
    name: msg`Sales orders`,
    group: "sales",
    defaultCategory: 0,
    covers: msg`sales orders with lines made to order or shipped from stock; confirm (PDF, email), create jobs from lines, ship and invoice`,
    needs: [["sales.customers"], ["items.parts"]]
  },
  {
    key: "sales.quotes",
    name: msg`Quotes`,
    group: "sales",
    defaultCategory: 1,
    covers: msg`quotes with a method and cost rollup per line, quantity-break pricing, pricing rules, revisions and a customer share page; convert to a sales order`,
    needs: [["sales.customers"], ["items.parts"]]
  },
  {
    key: "sales.rfqs",
    name: msg`Customer RFQs`,
    group: "sales",
    defaultCategory: 2,
    covers: msg`inbound customer requests for quote, converted to quotes`,
    needs: [["sales.customers"]]
  },
  {
    key: "sales.returns",
    name: msg`Sales returns`,
    group: "sales",
    defaultCategory: 2,
    covers: msg`return orders (RMAs), optionally against a sales order, with return reasons; returned units come back on hold or ship back to the customer`,
    needs: [["sales.customers"], ["inventory.stock"]]
  },
  {
    key: "sales.customer-portal",
    name: msg`Customer portal`,
    group: "sales",
    defaultCategory: 2,
    covers: msg`a share link per customer showing their order lines and live job progress; Business plan`,
    needs: [["sales.customers"], ["sales.orders"]]
  },
  {
    key: "sales.contracts",
    name: msg`Customer contracts`,
    group: "sales",
    defaultCategory: 3,
    covers: msg`service billing agreements with one-time and recurring lines, an invoice schedule, a revenue plan, amendments, cancellation and renewal`,
    needs: [["sales.customers"], ["items.services"], ["invoicing.sales"]]
  },
  {
    key: "sales.rentals",
    name: msg`Rental agreements`,
    group: "sales",
    defaultCategory: 3,
    covers: msg`renting serialized fleet units held as fixed assets; billed in periods, delivered and returned through shipments and receipts`,
    needs: [
      ["sales.customers"],
      ["accounting.fixed-assets"],
      ["inventory.traceability"],
      ["invoicing.sales"]
    ]
  },
  {
    key: "quality.inspections",
    name: msg`Inspection plans and inspections`,
    group: "quality",
    defaultCategory: 1,
    covers: msg`inspection documents with ballooned drawings and AQL sampling; inspections on receipts and on job operations in the shop floor app; gauges and calibration records`,
    needs: [
      ["items.parts", "items.materials"],
      ["inventory.receipts", "mes.operations"]
    ]
  },
  {
    key: "quality.issues",
    name: msg`Issues and nonconformances`,
    group: "quality",
    defaultCategory: 1,
    covers: msg`nonconformances linked to items, suppliers, customers, jobs and orders; configurable workflows and required actions; a supplier corrective action share page; raised from the shop floor app`,
    needs: []
  },
  {
    key: "quality.documents",
    name: msg`Controlled quality documents`,
    group: "quality",
    defaultCategory: 2,
    covers: msg`versioned quality documents (SOPs) in Draft, Active and Archived states; approval rules can gate them`,
    needs: []
  },
  {
    key: "quality.training",
    name: msg`Training records`,
    group: "quality",
    defaultCategory: 2,
    covers: msg`training programs with assignments, quizzes and recertification; completion can grant an ability; lives under Resources in the app`,
    needs: [["people.employees"]]
  },
  {
    key: "people.employees",
    name: msg`Employees and employee types`,
    group: "people",
    defaultCategory: 1,
    covers: msg`employee records with title, location, department, shift and manager; employee types are permission sets, and editing them is Business plan`,
    needs: [["users.accounts"]]
  },
  {
    key: "people.operators",
    name: msg`Shop-floor operators`,
    group: "people",
    defaultCategory: 1,
    covers: msg`console operators with no email who sign in to a shared shop floor console with a 4-digit PIN; console mode is Business plan`,
    needs: [["mes.operations"]]
  },
  {
    key: "people.shifts",
    name: msg`Shifts`,
    group: "people",
    defaultCategory: 2,
    covers: msg`shifts per location with working days and hours, plus holidays; used by scheduling and work-center hours`,
    needs: [["resources.locations"]]
  },
  {
    key: "people.abilities",
    name: msg`Abilities`,
    group: "people",
    defaultCategory: 2,
    covers: msg`process qualifications per employee with expiry; a process that requires an ability gates scheduling and shop floor start; lives under Resources in the app`,
    needs: [["resources.processes"], ["people.employees"]]
  },
  {
    key: "people.reimbursements",
    name: msg`Reimbursements`,
    group: "people",
    defaultCategory: 3,
    covers: msg`employee expense reimbursements imported from Ramp and paid out as payments; never created by hand`,
    needs: [["people.employees"], ["invoicing.payments"]]
  },
  {
    key: "users.accounts",
    name: msg`User accounts`,
    group: "users",
    defaultCategory: 0,
    covers: msg`employee logins by email invite, customer and supplier user accounts, groups and per-user permissions; editing permissions is Business plan`,
    needs: []
  },
  {
    key: "invoicing.sales",
    name: msg`Sales invoices`,
    group: "invoicing",
    defaultCategory: 1,
    covers: msg`invoices from sales orders and shipments; posting writes the journal; email, PDF and optional Stripe Connect card and ACH payment`,
    needs: [["inventory.shipments", "sales.orders"]]
  },
  {
    key: "invoicing.purchase",
    name: msg`Purchase invoices`,
    group: "invoicing",
    defaultCategory: 1,
    covers: msg`supplier invoices against purchase order lines or standalone; posting writes the journal`,
    needs: [["purchasing.suppliers"], ["resources.locations"]]
  },
  {
    key: "invoicing.payments",
    name: msg`Payments`,
    group: "invoicing",
    defaultCategory: 2,
    covers: msg`customer receipts, supplier disbursements, credit and debit memos, deposits and aging; a payment is the only way Carbon marks an invoice paid, apart from an accounting sync`,
    needs: [["invoicing.sales", "invoicing.purchase"]]
  },
  {
    key: "accounting.ledger",
    name: msg`Chart of accounts, journals and financial reports`,
    group: "accounting",
    defaultCategory: 2,
    covers: msg`chart of accounts, journal entries, periods and close, cost centers, dimensions, trial balance, balance sheet, income statement and AR/AP aging; an accounting cutover date starts posted journals`,
    needs: []
  },
  {
    key: "accounting.currencies",
    name: msg`Foreign currencies and exchange rates`,
    group: "accounting",
    defaultCategory: 2,
    covers: msg`documents in foreign currencies, exchange rates and company overrides, FX gains and losses`,
    needs: []
  },
  {
    key: "accounting.fixed-assets",
    name: msg`Fixed assets and depreciation`,
    group: "accounting",
    defaultCategory: 3,
    covers: msg`asset classes, depreciation runs (straight line, declining balance, MACRS, units of production), capitalization from stock and disposal`,
    needs: [["accounting.ledger"]]
  },
  {
    key: "accounting.revenue-recognition",
    name: msg`Revenue recognition`,
    group: "accounting",
    defaultCategory: 3,
    covers: msg`deferral and accrual schedules for service, rental and contract lines, posted by monthly recognition runs`,
    needs: [["accounting.ledger"], ["invoicing.sales"]]
  },
  {
    key: "accounting.multi-company",
    name: msg`Multiple companies and intercompany`,
    group: "accounting",
    defaultCategory: 3,
    covers: msg`subsidiaries in a company group, intercompany matching and eliminations, consolidated reports with currency translation`,
    needs: [["accounting.ledger"]]
  },
  {
    key: "documents.files",
    name: msg`Files on items, jobs and orders`,
    group: "documents",
    defaultCategory: 1,
    covers: msg`a company document library with labels, search and trash, plus attachments on parts, jobs, sales orders, purchase orders, customers and suppliers`,
    needs: []
  },
  {
    key: "platform.document-templates",
    name: msg`Document templates`,
    group: "platform",
    defaultCategory: 1,
    covers: msg`a layout editor for printed documents: quote, sales order, sales invoice, RMA, purchase order, supplier return, packing slip, stock transfer, job traveler, issue and tracking label`,
    needs: []
  },
  {
    key: "platform.email",
    name: msg`Sending documents by email`,
    group: "platform",
    defaultCategory: 1,
    covers: msg`emailing quotes, sales orders, sales invoices, purchase orders, purchasing RFQs and supplier quotes to contacts; the Email integration sends from the company's own domain through Resend or SMTP, on every plan`,
    needs: []
  },
  {
    key: "platform.approvals",
    name: msg`Approval rules`,
    group: "platform",
    defaultCategory: 2,
    covers: msg`approval rules for purchase orders by amount, quality documents and suppliers; Business plan`,
    needs: [["purchasing.orders", "quality.documents", "purchasing.suppliers"]]
  },
  {
    key: "platform.workflows",
    name: msg`Workflows and automations`,
    group: "platform",
    defaultCategory: 2,
    covers: msg`automations built from triggers, conditions and actions, versioned and published, with run history; Business plan`,
    needs: []
  },
  {
    key: "platform.ai-agents",
    name: msg`AI agent access over MCP`,
    group: "platform",
    defaultCategory: 2,
    covers: msg`an MCP server exposing about 1,500 ERP tools to Claude and other agents through OAuth or an API key; Business plan`,
    needs: []
  },
  {
    key: "integrations.cad",
    name: msg`CAD integration`,
    group: "platform",
    defaultCategory: 2,
    covers: msg`Onshape and Onshape Government: import a BOM from an Onshape assembly into a part's method, and attach released models and drawings to existing items; Business plan`,
    needs: [["items.parts"], ["items.methods"]]
  },
  {
    key: "integrations.accounting",
    name: msg`External accounting system integration`,
    group: "platform",
    defaultCategory: 3,
    covers: msg`Xero and Rillet sync customers and suppliers and post sales invoices and bills; Rillet also takes production and inventory journals and returns payments to Carbon; QuickBooks Online and Sage Intacct are defined but switched off at aa5a8a032; Business plan`,
    needs: [["invoicing.sales", "invoicing.purchase"]]
  }
];

// An answer's effect on one feature. A plain effect raises the feature to the
// category (towards 0) and never moves one that already sits higher; a "lower"
// effect moves it away from 0 and applies only if no answer raised it.
export interface PriorityEffect {
  feature: string;
  category: PriorityCategory;
  lower?: true;
}

export interface PriorityOption {
  key: string; // stable within its question, e.g. "quote"
  label: MessageDescriptor;
  effects: PriorityEffect[];
  // Raises one more feature when another question has a given answer.
  when?: {
    question: string;
    option: string;
    effect: PriorityEffect;
  };
  note?: MessageDescriptor;
}

// What happens to a tool a company uses today: replaced with Carbon at go-live
// ("retire"), replaced later, kept and connected to Carbon, or kept separate.
export type PrioritySystemChoice = "retire" | "later" | "connect" | "keep";

// An area of the business a tool can cover, asked in each tool's follow-up:
// the features that cover it, and what may happen to the tool used for it. An
// area with no features is one Carbon works next to and never replaces (CAD).
export interface PrioritySystemRow {
  key: string;
  area: MessageDescriptor;
  features: string[];
  choices: PrioritySystemChoice[];
  // What "Keep and connect" places: the integration that connects the tool.
  connect?: PriorityEffect[];
  // Listed on the page as a starter function, with a field for its tool.
  starter?: true;
}

// A page on docs.carbon.ms that explains a question's features.
export interface PriorityLink {
  title: MessageDescriptor;
  url: string;
}

export interface PriorityQuestion {
  key: string; // stable, e.g. "orderStart"
  label: MessageDescriptor;
  help?: MessageDescriptor;
  // Why the answer matters, in Carbon's words, and where to read more.
  why?: MessageDescriptor;
  learnMore?: PriorityLink[];
  multiple?: true;
  options: PriorityOption[];
  // Only on the systems question (today's tools): the areas each tool's
  // follow-up asks about. The question itself is answered with the list.
  systems?: PrioritySystemRow[];
}

// A section is asked when its condition holds, e.g. finance only when Carbon
// will keep the books. "unless" inverts it.
export interface PrioritySectionCondition {
  type: "when" | "unless";
  question: string;
  options: string[];
}

export interface PrioritySection {
  key: string;
  title: MessageDescriptor;
  condition?: PrioritySectionCondition;
  // Asked only on a blank start.
  blankStartOnly?: true;
  questions: PriorityQuestion[];
}

export const PRIORITY_SECTIONS: PrioritySection[] = [
  {
    key: "ai",
    title: msg`AI assistant`,
    questions: [
      {
        key: "aiAssistant",
        label: msg`Would you like an AI assistant, such as Claude or ChatGPT, to enter data in Carbon?`,
        options: [
          {
            key: "onboarding",
            label: msg`Yes, during onboarding`,
            effects: [{ feature: "platform.ai-agents", category: 0 }]
          },
          {
            key: "later",
            label: msg`Yes, later`,
            effects: [{ feature: "platform.ai-agents", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      }
    ]
  },
  {
    key: "tools",
    title: msg`Today's tools`,
    questions: [
      {
        key: "systems",
        label: msg`Which tools do you use today?`,
        help: msg`For each function, name the tool you use today, spreadsheets and paper included. Add a row for anything else. How you use each tool comes at the end.`,
        options: [],
        systems: [
          {
            key: "quoting",
            area: msg`Quoting`,
            features: ["sales.quotes"],
            choices: ["retire", "later", "connect", "keep"],
            starter: true
          },
          {
            key: "orderEntry",
            area: msg`Order entry`,
            features: ["sales.customers", "sales.orders"],
            choices: ["retire", "later", "connect", "keep"],
            starter: true
          },
          {
            key: "purchasing",
            area: msg`Purchasing`,
            features: [
              "purchasing.suppliers",
              "purchasing.orders",
              "items.supplier-parts"
            ],
            choices: ["retire", "later", "connect", "keep"],
            starter: true
          },
          {
            key: "inventory",
            area: msg`Inventory`,
            features: ["inventory.stock", "inventory.storage-units"],
            choices: ["retire", "later", "connect", "keep"],
            starter: true
          },
          {
            key: "production",
            area: msg`Production tracking`,
            features: ["production.jobs", "mes.operations"],
            choices: ["retire", "later", "connect", "keep"],
            starter: true
          },
          {
            key: "planning",
            area: msg`Planning and scheduling`,
            features: ["production.mrp", "production.scheduling"],
            choices: ["retire", "later", "connect", "keep"]
          },
          {
            key: "quality",
            area: msg`Quality`,
            features: [
              "quality.inspections",
              "quality.issues",
              "quality.documents"
            ],
            choices: ["retire", "later", "connect", "keep"],
            starter: true
          },
          {
            key: "invoicing",
            area: msg`Invoicing`,
            features: ["invoicing.sales", "invoicing.purchase"],
            choices: ["retire", "later", "connect", "keep"],
            connect: [{ feature: "integrations.accounting", category: 1 }]
          },
          {
            key: "accounting",
            area: msg`Accounting`,
            features: ["accounting.ledger"],
            choices: ["retire", "later", "connect", "keep"],
            starter: true,
            connect: [{ feature: "integrations.accounting", category: 1 }]
          },
          {
            key: "time",
            area: msg`Time and attendance`,
            features: ["mes.time-cards", "people.shifts"],
            choices: ["retire", "later", "connect", "keep"]
          },
          {
            key: "maintenance",
            area: msg`Maintenance`,
            features: ["resources.maintenance"],
            choices: ["retire", "later", "connect", "keep"]
          },
          {
            key: "cad",
            area: msg`CAD`,
            features: [],
            choices: ["connect", "keep"],
            starter: true,
            connect: [{ feature: "integrations.cad", category: 1 }]
          },
          {
            key: "nesting",
            area: msg`CAM and nesting`,
            features: [],
            choices: ["connect", "keep"]
          }
        ]
      }
    ]
  },
  {
    key: "accounting",
    title: msg`Accounting`,
    questions: [
      {
        key: "books",
        label: msg`Will Carbon keep your books (general ledger)?`,
        why: msg`Carbon posts a journal for every receipt, shipment, invoice and payment. If Carbon keeps your books, the chart of accounts and its default accounts need to be right before anything posts. If the books stay in another system, Carbon can sync invoices and bills to it.`,
        learnMore: [
          {
            title: msg`Accounting and the ledger`,
            url: "https://docs.carbon.ms/docs/reference/accounting"
          },
          {
            title: msg`Accounting integrations`,
            url: "https://docs.carbon.ms/docs/integrations/accounting"
          }
        ],
        options: [
          {
            key: "yes",
            label: msg`Yes, from go-live`,
            effects: [
              { feature: "accounting.ledger", category: 0 },
              { feature: "invoicing.purchase", category: 0 },
              { feature: "invoicing.payments", category: 1 }
            ]
          },
          {
            key: "elsewhere",
            label: msg`No, the books stay in another system`,
            effects: [
              { feature: "accounting.ledger", category: 3, lower: true },
              { feature: "integrations.accounting", category: 1 }
            ]
          },
          {
            key: "later",
            label: msg`Later`,
            effects: [{ feature: "accounting.ledger", category: 1 }]
          }
        ]
      },
      {
        key: "invoicing",
        label: msg`Will you invoice customers from Carbon?`,
        why: msg`Carbon raises a sales invoice from a sales order or a posted shipment and posts it to the ledger. Posting never marks an invoice paid: a posted payment does, or a payment synced back from your accounting system.`,
        learnMore: [
          {
            title: msg`Invoices`,
            url: "https://docs.carbon.ms/docs/reference/invoices"
          }
        ],
        options: [
          {
            key: "yes",
            label: msg`Yes, from go-live`,
            effects: [
              { feature: "invoicing.sales", category: 0 },
              { feature: "platform.document-templates", category: 0 },
              { feature: "invoicing.payments", category: 1 }
            ],
            note: msg`Without an accounting sync, a payment is the only way an invoice is marked paid.`
          },
          {
            key: "elsewhere",
            label: msg`No, invoicing stays in another system`,
            effects: [
              { feature: "invoicing.sales", category: 3, lower: true },
              { feature: "integrations.accounting", category: 1 }
            ]
          },
          {
            key: "later",
            label: msg`Later`,
            effects: []
          }
        ]
      }
    ]
  },
  {
    key: "foundation",
    title: msg`Foundation`,
    blankStartOnly: true,
    questions: [
      {
        key: "buy",
        label: msg`Do you buy material or parts from suppliers?`,
        multiple: true,
        options: [
          {
            key: "rawMaterial",
            label: msg`Raw material, such as sheet, bar, resin or wire`,
            effects: [
              { feature: "items.materials", category: 0 },
              { feature: "purchasing.orders", category: 0 },
              { feature: "inventory.receipts", category: 0 },
              { feature: "inventory.stock", category: 0 }
            ]
          },
          {
            key: "components",
            label: msg`Finished components, such as fasteners, electronics or bought-in assemblies`,
            effects: [
              { feature: "items.parts", category: 0 },
              { feature: "purchasing.orders", category: 0 },
              { feature: "inventory.receipts", category: 0 },
              { feature: "inventory.stock", category: 0 }
            ]
          },
          {
            key: "supplies",
            label: msg`Supplies used up in production, such as adhesives, abrasives or packaging`,
            effects: [
              { feature: "items.consumables", category: 1 },
              { feature: "purchasing.orders", category: 0 },
              { feature: "inventory.receipts", category: 0 }
            ]
          },
          {
            key: "none",
            label: msg`No, customers supply the material`,
            effects: []
          }
        ]
      },
      {
        key: "make",
        label: msg`Do you make or assemble products yourselves?`,
        options: [
          {
            key: "yes",
            label: msg`Yes, in-house`,
            effects: [
              { feature: "production.jobs", category: 0 },
              { feature: "items.methods", category: 0 },
              { feature: "resources.work-centers", category: 0 }
            ]
          },
          {
            key: "resell",
            label: msg`No, we buy and resell`,
            effects: [{ feature: "items.parts", category: 0 }]
          }
        ]
      },
      {
        key: "sell",
        label: msg`What do you sell?`,
        multiple: true,
        options: [
          {
            key: "products",
            label: msg`Physical products`,
            effects: [
              { feature: "inventory.shipments", category: 0 },
              { feature: "inventory.stock", category: 0 }
            ]
          },
          {
            key: "services",
            label: msg`Services, such as repairs or engineering time`,
            effects: [{ feature: "items.services", category: 0 }]
          }
        ]
      }
    ]
  },
  {
    key: "core",
    title: msg`Core questions`,
    questions: [
      {
        key: "business",
        label: msg`What describes your business?`,
        multiple: true,
        options: [
          {
            key: "oem",
            label: msg`We design and build our own products (OEM or product company)`,
            effects: [
              { feature: "production.mrp", category: 0 },
              { feature: "items.change-control", category: 1 }
            ]
          },
          {
            key: "toOrder",
            label: msg`We make parts or assemblies to customer drawings or designs (job shop or contract manufacturer)`,
            effects: [
              { feature: "sales.quotes", category: 0 },
              { feature: "documents.files", category: 0 }
            ]
          },
          {
            key: "configure",
            label: msg`Customers choose options before they order (configure to order)`,
            effects: [
              { feature: "items.configurator", category: 0 },
              { feature: "sales.quotes", category: 0 }
            ]
          }
        ]
      },
      {
        key: "orderStart",
        label: msg`How does a typical order start?`,
        options: [
          {
            key: "quote",
            label: msg`We send a quote and the customer accepts it`,
            effects: [{ feature: "sales.quotes", category: 0 }]
          },
          {
            key: "priceList",
            label: msg`The customer orders from our price list or catalogue`,
            effects: []
          },
          {
            key: "rfq",
            label: msg`The customer sends a formal request for quote that we answer`,
            effects: [
              { feature: "sales.quotes", category: 0 },
              { feature: "sales.rfqs", category: 1 }
            ]
          }
        ]
      },
      {
        key: "buildTo",
        label: msg`Do you build to customer orders or to stock?`,
        options: [
          {
            key: "order",
            label: msg`Only against customer orders`,
            effects: []
          },
          {
            key: "stock",
            label: msg`To stock or forecast, or both`,
            effects: [{ feature: "production.mrp", category: 0 }]
          }
        ]
      },
      {
        key: "planning",
        label: msg`Does a typical product have many purchased parts, sub-assemblies inside assemblies, or parts that take more than four weeks to arrive?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [
              { feature: "production.mrp", category: 0 },
              { feature: "items.supplier-parts", category: 0 }
            ]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "traceability",
        label: msg`Must you trace individual units or material lots, for customers, warranty or regulation?`,
        options: [
          {
            key: "yes",
            label: msg`Yes, by serial number on finished units, or by lot or batch on material or output`,
            effects: [{ feature: "inventory.traceability", category: 0 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "qualityStandard",
        label: msg`Do you work to a quality standard, such as ISO 9001, AS9100, ISO 13485 or IATF 16949?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [
              { feature: "quality.inspections", category: 0 },
              { feature: "quality.issues", category: 0 },
              { feature: "inventory.traceability", category: 0 },
              { feature: "items.change-control", category: 1 },
              { feature: "quality.documents", category: 1 },
              { feature: "quality.training", category: 1 }
            ]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "outsideProcessing",
        label: msg`Do you send parts out for processing, such as coating, plating, heat treatment or machining?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "purchasing.outside-processing", category: 0 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "shopFloor",
        label: msg`Who records work on the shop floor?`,
        options: [
          {
            key: "operators",
            label: msg`Operators, at their station or machine`,
            effects: [{ feature: "people.operators", category: 0 }]
          },
          {
            key: "office",
            label: msg`A supervisor or the office, after the work is done`,
            effects: [{ feature: "mes.operations", category: 1, lower: true }],
            note: msg`Jobs are completed in the ERP.`
          },
          {
            key: "undecided",
            label: msg`Not decided`,
            effects: []
          }
        ]
      }
    ]
  },
  {
    key: "buyingSelling",
    title: msg`Buying and selling`,
    questions: [
      {
        key: "currency",
        label: msg`Do you buy or sell in a currency other than your own?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "accounting.currencies", category: 0 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "documentsSent",
        label: msg`Will you send purchase orders, quotes or invoices from Carbon at go-live?`,
        why: msg`Carbon makes quotes, sales orders, invoices and purchase orders as PDFs on a default layout. The document template editor sets your own layout and logo, and Carbon can email the documents to your contacts.`,
        learnMore: [
          {
            title: msg`Email`,
            url: "https://docs.carbon.ms/docs/integrations/email"
          }
        ],
        options: [
          {
            key: "pdf",
            label: msg`Yes, as PDFs we send ourselves`,
            effects: [{ feature: "platform.document-templates", category: 0 }]
          },
          {
            key: "email",
            label: msg`Yes, emailed from Carbon`,
            effects: [
              { feature: "platform.document-templates", category: 0 },
              { feature: "platform.email", category: 0 }
            ]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "approvals",
        label: msg`Do purchases need sign-off above a limit, or do new suppliers need approval?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "platform.approvals", category: 0 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "supplierQuotes",
        label: msg`Do you collect competing quotes from suppliers?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "purchasing.supplier-quotes", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "customerReturns",
        label: msg`Do customers return goods for repair, rework or credit?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "sales.returns", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "supplierReturns",
        label: msg`Do you return goods to suppliers?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "purchasing.returns", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "portal",
        label: msg`Should customers follow their orders and job progress through a private link?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "sales.customer-portal", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      }
    ]
  },
  {
    key: "inventoryItems",
    title: msg`Inventory and items`,
    questions: [
      {
        key: "sites",
        label: msg`How many sites hold stock?`,
        options: [
          {
            key: "one",
            label: msg`One`,
            effects: []
          },
          {
            key: "many",
            label: msg`More than one`,
            effects: [{ feature: "inventory.transfers", category: 1 }]
          }
        ]
      },
      {
        key: "bins",
        label: msg`Do you need to know which shelf or bin each item is on?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "inventory.storage-units", category: 0 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "counts",
        label: msg`Do you count stock, in full or in cycles?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "inventory.counts", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "picking",
        label: msg`Do you pick materials for a job before production starts?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "inventory.picking-lists", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "consumables",
        label: msg`Do consumables, such as adhesives, labels or packaging, appear on your bills of material?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "items.consumables", category: 0 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "services",
        label: msg`Do you sell services, such as repairs, engineering time or setup charges?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "items.services", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "tooling",
        label: msg`Do you track tooling, such as fixtures, dies or moulds, as items?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "items.tools", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      }
    ]
  },
  {
    key: "shopFloorPeople",
    title: msg`Shop floor and people`,
    condition: { type: "unless", question: "shopFloor", options: ["office"] },
    questions: [
      {
        key: "capacity",
        label: msg`Is capacity your main constraint, with machines or people overbooked?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "production.scheduling", category: 0 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "payroll",
        label: msg`Do you need hours per person for payroll?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [
              { feature: "mes.time-cards", category: 0 },
              { feature: "people.shifts", category: 1 }
            ]
          },
          {
            key: "no",
            label: msg`No`,
            effects: [],
            note: msg`Operation time is recorded in the shop floor app without time cards.`
          }
        ]
      },
      {
        key: "qualifications",
        label: msg`Are some operations limited to qualified people?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [
              { feature: "people.abilities", category: 1 },
              { feature: "quality.training", category: 1 }
            ]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "workInstructions",
        label: msg`Do operators follow written work instructions at the station?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "production.work-instructions", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "maintenance",
        label: msg`Do machines have planned maintenance that you track?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "resources.maintenance", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "restrictedAccess",
        label: msg`Should anyone using Carbon in the first month see less than everything?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "people.employees", category: 0 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: [],
            note: msg`User accounts are always needed.`
          }
        ]
      }
    ]
  },
  {
    key: "engineering",
    title: msg`Engineering`,
    questions: [
      {
        key: "designChanges",
        label: msg`How often do released designs change?`,
        options: [
          {
            key: "rarely",
            label: msg`Rarely`,
            effects: []
          },
          {
            key: "often",
            label: msg`Often, or through formal change orders`,
            effects: [{ feature: "items.change-control", category: 1 }],
            when: {
              question: "qualityStandard",
              option: "yes",
              effect: { feature: "items.change-control", category: 0 }
            }
          }
        ]
      }
    ]
  },
  {
    key: "quality",
    title: msg`Quality`,
    condition: { type: "when", question: "qualityStandard", options: ["no"] },
    questions: [
      {
        key: "inspections",
        label: msg`Do you inspect incoming material or finished parts against a plan?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "quality.inspections", category: 0 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "nonconformances",
        label: msg`Do you record nonconformances or corrective actions?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "quality.issues", category: 0 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "controlledDocuments",
        label: msg`Do you keep procedures or work instructions under revision control?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "quality.documents", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      }
    ]
  },
  {
    key: "finance",
    title: msg`Finance`,
    condition: { type: "when", question: "books", options: ["yes", "later"] },
    questions: [
      {
        key: "fixedAssets",
        label: msg`Do you own equipment that you depreciate?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "accounting.fixed-assets", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "entities",
        label: msg`Do you run more than one legal entity?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "accounting.multi-company", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "revenueRecognition",
        label: msg`Do you bill services or subscriptions that are earned over time?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [
              { feature: "accounting.revenue-recognition", category: 1 }
            ]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      },
      {
        key: "rentalsContracts",
        label: msg`Do you rent equipment out, or bill against customer contracts?`,
        options: [
          {
            key: "rentals",
            label: msg`Rentals`,
            effects: [{ feature: "sales.rentals", category: 1 }]
          },
          {
            key: "contracts",
            label: msg`Contracts`,
            effects: [{ feature: "sales.contracts", category: 1 }]
          },
          {
            key: "neither",
            label: msg`Neither`,
            effects: []
          }
        ]
      }
    ]
  },
  {
    key: "automation",
    title: msg`Automation`,
    questions: [
      {
        key: "automation",
        label: msg`Are there repeated steps you want automated, such as notifying someone when a status changes?`,
        options: [
          {
            key: "yes",
            label: msg`Yes`,
            effects: [{ feature: "platform.workflows", category: 1 }]
          },
          {
            key: "no",
            label: msg`No`,
            effects: []
          }
        ]
      }
    ]
  }
];

// A blank start places nothing until an answer does, except these: what every
// company has or needs whatever it answers.
export const PRIORITY_ASSUMED: {
  feature: string;
  category: PriorityCategory;
  reason: MessageDescriptor;
}[] = [
  {
    feature: "resources.locations",
    category: 0,
    reason: msg`Created at signup`
  },
  { feature: "users.accounts", category: 0, reason: msg`Created at signup` },
  {
    feature: "sales.customers",
    category: 0,
    reason: msg`Every company sells to someone`
  },
  {
    feature: "sales.orders",
    category: 0,
    reason: msg`Every company sells to someone`
  }
];

// Extra effects on a blank start, for answers that leave a feature at its
// default when starting from defaults, where a blank start would leave it out.
export const PRIORITY_BLANK_START_EFFECTS: {
  question: string;
  option: string;
  effects: PriorityEffect[];
}[] = [
  {
    question: "shopFloor",
    option: "operators",
    effects: [{ feature: "mes.operations", category: 0 }]
  },
  {
    question: "shopFloor",
    option: "undecided",
    effects: [{ feature: "mes.operations", category: 1 }]
  },
  {
    question: "invoicing",
    option: "later",
    effects: [{ feature: "invoicing.sales", category: 1 }]
  }
];

export const PRIORITY_SYSTEM_CHOICE_LABEL: Record<
  PrioritySystemChoice,
  MessageDescriptor
> = {
  retire: msg`Replace with Carbon`,
  later: msg`Replace later`,
  connect: msg`Keep and connect`,
  keep: msg`Keep separate`
};

// How Carbon supports a tool a company names today: a live integration, one
// built but switched off, or an import from CSV. A tool not listed has none.
export type PriorityToolSupport = "integration" | "unavailable" | "import";

export interface PriorityTool {
  name: string;
  aliases: string[];
  // Systems rows the tool usually covers.
  rows: string[];
  support: PriorityToolSupport;
  summary: MessageDescriptor;
  docs?: string;
  // Carbon's experience with the tool: for Carbon staff only, never over MCP.
  staffNote?: MessageDescriptor;
}

export const PRIORITY_TOOLS: PriorityTool[] = [
  {
    name: "Xero",
    aliases: [],
    rows: ["accounting", "invoicing"],
    support: "integration",
    summary: msg`Carbon connects to Xero on the Business plan: it sends customers, vendors, items, sales invoices, bills and journals to Xero, and payments recorded in Xero come back to Carbon.`,
    docs: "https://docs.carbon.ms/docs/integrations/accounting"
  },
  {
    name: "Rillet",
    aliases: [],
    rows: ["accounting", "invoicing"],
    support: "integration",
    summary: msg`Carbon connects to Rillet on the Business plan: it posts invoices, bills and journals to Rillet's ledger, keeps customers and vendors in sync, and payments move in both directions.`,
    docs: "https://docs.carbon.ms/docs/integrations/accounting"
  },
  {
    name: "QuickBooks Online",
    aliases: ["QuickBooks", "QBO"],
    rows: ["accounting", "invoicing"],
    support: "unavailable",
    summary: msg`Carbon's QuickBooks Online integration is not available yet. Until it is, QuickBooks can stay your ledger next to Carbon.`
  },
  {
    name: "Sage Intacct",
    aliases: ["Sage", "Intacct"],
    rows: ["accounting", "invoicing"],
    support: "unavailable",
    summary: msg`Carbon's Sage Intacct integration is not available yet. Until it is, Sage can stay your ledger next to Carbon.`
  },
  {
    name: "Paperless Parts",
    aliases: ["Paperless"],
    rows: ["quoting"],
    support: "integration",
    summary: msg`Carbon connects to Paperless Parts on the Business plan: quotes and bills of material made in Paperless Parts come into Carbon, where they become sales orders and jobs.`,
    docs: "https://docs.carbon.ms/docs/integrations/estimating"
  },
  {
    name: "Ramp",
    aliases: [],
    rows: ["purchasing"],
    support: "integration",
    summary: msg`Carbon connects to Ramp on the Business plan: purchase orders and vendor bills stay in sync, and Carbon can act as Ramp's accounting system.`
  },
  {
    name: "Onshape",
    aliases: ["Onshape Government"],
    rows: ["cad"],
    support: "integration",
    summary: msg`Carbon connects to Onshape and Onshape Government on the Business plan: it imports parts and bills of material from your documents and can attach released models and drawings to items.`,
    docs: "https://docs.carbon.ms/docs/integrations/cad"
  },
  {
    name: "Radan",
    aliases: [],
    rows: ["nesting"],
    support: "integration",
    summary: msg`Carbon connects to Radan on the Business plan: Radan reads data from Carbon and sends its results back.`
  },
  {
    name: "Mount",
    aliases: [],
    rows: ["quality"],
    support: "integration",
    summary: msg`Carbon connects to Mount on the Business plan: Carbon stays the record and pushes its data to your Mount tenant.`
  },
  {
    name: "Linear",
    aliases: [],
    rows: [],
    support: "integration",
    summary: msg`Carbon links nonconformance action tasks to Linear issues on the Business plan; status, assignee and notes sync both ways.`,
    docs: "https://docs.carbon.ms/docs/integrations/project-management"
  },
  {
    name: "Jira",
    aliases: [],
    rows: [],
    support: "integration",
    summary: msg`Carbon links nonconformance action tasks to Jira issues on the Business plan; status, assignee and notes sync both ways.`,
    docs: "https://docs.carbon.ms/docs/integrations/project-management"
  },
  {
    name: "Spreadsheets",
    aliases: ["Spreadsheet", "Excel", "Google Sheets", "Sheets"],
    rows: [],
    support: "import",
    summary: msg`Carbon imports spreadsheets saved as CSV: items, bills of material and routings, customers, suppliers, work centers, storage units and opening stock.`,
    docs: "https://docs.carbon.ms/docs/reference/import-export"
  }
];
