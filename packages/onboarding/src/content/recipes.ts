import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { SystemToday } from "./intake";

// Load Your Data — the per-source recipes. Because the intake asked what the
// factory runs on, each data set opens with step-by-step instructions for
// producing exactly the data we need from THAT source. These are content, not
// code — some of the highest-leverage words in the hub. Deliberately no
// product-by-product connection promises: every source gets plain steps that
// end in a file, and the import pipeline does the rest.

export type DataSetKey =
  | "customers"
  | "suppliers"
  | "items"
  | "boms"
  | "pricing";

export interface DataSetDef {
  key: DataSetKey;
  title: MessageDescriptor;
  detail: MessageDescriptor;
  // What we genuinely need vs. what's nice to have — the import mapper handles
  // messy columns; this line kills the "is my file good enough?" doubt.
  needs: MessageDescriptor;
  // The setup-row key whose ERP screen hosts this data (drives the deep link
  // through the same resolveScreenUrl mapping the Setup Map uses).
  screenKey: string;
  // Which board task marks this set loaded (content/board.ts key).
  taskKey: string;
}

export const DATA_SETS: DataSetDef[] = [
  {
    key: "customers",
    title: msg`Customers and their contacts`,
    detail: msg`Who you sell to. Start with the ones you've sold to this year — the rest can come over any time.`,
    needs: msg`We need at minimum a name per customer. Contacts, emails, phone numbers, and payment terms all help but nothing is required.`,
    screenKey: "customers",
    taskKey: "load-customers"
  },
  {
    key: "suppliers",
    title: msg`Suppliers and their contacts`,
    detail: msg`Who you buy from. Same shape as customers — one row per supplier.`,
    needs: msg`A name per supplier is enough. Contacts and terms help.`,
    screenKey: "suppliers",
    taskKey: "load-suppliers"
  },
  {
    key: "items",
    title: msg`Items — parts, materials, tools`,
    detail: msg`What you make, buy, and stock. Import active items only — made, bought, or sold in the last 12 months.`,
    needs: msg`A part number and a name per item. Costs, units, and types help; we'll propose the rest.`,
    screenKey: "parts",
    taskKey: "load-items"
  },
  {
    key: "boms",
    title: msg`BOMs and routings`,
    detail: msg`What goes into what, and the steps to make it. Start with what you actually ship this quarter.`,
    needs: msg`Parent part, component part, and quantity per line. Operation steps are welcome in the same file.`,
    screenKey: "parts",
    taskKey: "load-boms"
  },
  {
    key: "pricing",
    title: msg`Price lists and customer pricing`,
    detail: msg`Only for catalog and repeat-order business — how each customer's price is decided.`,
    needs: msg`Part number, price, and (if it varies) the customer it applies to.`,
    screenKey: "price-lists",
    taskKey: "load-pricing"
  }
];

// Per-source recipe steps, in the customer's own vocabulary. Keyed by the
// intake's "what runs the business today" answer; a factory with several
// sources sees each set's most specific recipe.
export const SOURCE_RECIPES: Record<SystemToday, MessageDescriptor[]> = {
  spreadsheets: [
    msg`Find the spreadsheet you already keep — the real one, even if it's messy.`,
    msg`Don't clean it first. Mismatched columns, blank cells, odd names — reading that is our job, not yours.`,
    msg`Make sure it's one row per record (one customer, one item, one BOM line).`,
    msg`Upload it as-is — CSV or Excel both work.`
  ],
  "books-app": [
    msg`Open your accounting app and go to the list you need (customers, suppliers, or items).`,
    msg`Use its Export function and choose CSV or Excel.`,
    msg`Don't edit the export — upload it exactly as it came out.`
  ],
  "legacy-erp": [
    msg`In your old system, find the master-data report or export for this list (it's usually under Reports or Utilities).`,
    msg`Export to CSV or Excel. If the system only prints, a saved report file works too — we'll read it.`,
    msg`If you can't find the export, tell us which system it is and we'll send you the exact clicks.`
  ],
  homegrown: [
    msg`Ask whoever maintains the system for a CSV dump of the table behind this list.`,
    msg`Column names don't matter — we map them. One row per record does.`
  ],
  paper: [
    msg`No file needed — you'll type these in, starting with the ones that matter this quarter.`,
    msg`Open the screen and add them one at a time; it's faster than it sounds, and you can stop at "enough".`
  ]
};

// Which recipe leads for a factory with several sources: the most structured
// source wins for master data.
export function leadSource(systems: SystemToday[] | undefined): SystemToday {
  if (!systems || systems.length === 0) return "spreadsheets";
  const order: SystemToday[] = [
    "legacy-erp",
    "homegrown",
    "books-app",
    "spreadsheets",
    "paper"
  ];
  return order.find((s) => systems.includes(s)) ?? "spreadsheets";
}

// The switch-week rows — visible from day one, greyed, never a surprise later.
export const SWITCH_WEEK_SETS: {
  key: string;
  title: MessageDescriptor;
  detail: MessageDescriptor;
}[] = [
  {
    key: "stock-on-hand",
    title: msg`Stock on hand`,
    detail: msg`Counted the weekend before you switch, so it's current. Count sheets print from Carbon.`
  },
  {
    key: "open-pos",
    title: msg`Open purchase orders`,
    detail: msg`Entered in switch week so you can receive material from day one.`
  },
  {
    key: "open-orders",
    title: msg`Open customer orders`,
    detail: msg`Entered in switch week so you can ship and invoice from day one.`
  }
];
