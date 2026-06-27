import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Mod } from "../types";

export interface SetupRow {
  key: string; // stable, for the "configured" flag state
  object: MessageDescriptor; // the thing to set up (grounded in Carbon's nav labels)
  detail: MessageDescriptor; // short "what it is" hint
  moduleTags?: Mod[];
}

export interface SetupGroup {
  n: number;
  title: MessageDescriptor; // a Carbon module
  desc: MessageDescriptor;
  rows: SetupRow[];
}

// The first-run configuration map, grouped by Carbon module. Every master /
// reference / config entity a new company sets up before transacting, labelled as
// it appears in that module's navigation. Transactional documents (orders,
// receipts, timecards…) and runtime admin (billing, API keys, webhooks, audit
// logs) are intentionally excluded. Module-tagged rows drop out when their
// module is excluded, so an excluded module's group disappears.
export const SETUP_GROUPS: SetupGroup[] = [
  {
    n: 1,
    title: msg`Settings`,
    desc: msg`Company identity, documents, and system defaults.`,
    rows: [
      {
        key: "company",
        object: msg`Company`,
        detail: msg`Your legal name, addresses, branding, and document defaults`
      },
      {
        key: "document-templates",
        object: msg`Document Templates`,
        detail: msg`How your quotes, orders, and invoices look when they go out`
      },
      {
        key: "logos",
        object: msg`Logos`,
        detail: msg`The logos shown on your printed and emailed documents`
      },
      {
        key: "printing",
        object: msg`Printing`,
        detail: msg`The label and document printers your company prints to`
      },
      {
        key: "sequences",
        object: msg`Sequences`,
        detail: msg`Auto-numbering formats for orders, jobs, parts, and more`
      },
      {
        key: "custom-fields",
        object: msg`Custom Fields`,
        detail: msg`Extra fields to capture data Carbon doesn't track by default`
      },
      {
        key: "integrations",
        object: msg`Integrations`,
        detail: msg`Connect the outside tools your company already runs on`
      },
      {
        key: "approval-rules",
        object: msg`Approval Rules`,
        detail: msg`Who has to approve quotes, orders, and purchases — and when`
      }
    ]
  },
  {
    n: 2,
    title: msg`Resources`,
    desc: msg`Where and how you make things.`,
    rows: [
      {
        key: "locations",
        object: msg`Locations`,
        detail: msg`The plants, warehouses, and sites where your work and stock live`
      },
      {
        key: "work-centers",
        object: msg`Work Centers`,
        detail: msg`The machines, cells, and stations your work runs through`,
        moduleTags: ["prd"]
      },
      {
        key: "processes",
        object: msg`Processes`,
        detail: msg`The operations and steps your parts move through`,
        moduleTags: ["prd"]
      },
      {
        key: "training",
        object: msg`Training`,
        detail: msg`The skills and abilities you track for your people`
      },
      {
        key: "failure-modes",
        object: msg`Failure Modes`,
        detail: msg`The ways equipment fails, for maintenance and quality tracking`,
        moduleTags: ["prd"]
      },
      {
        key: "maintenance-schedules",
        object: msg`Maintenance Schedules`,
        detail: msg`Preventive maintenance schedules for your equipment`,
        moduleTags: ["prd"]
      }
    ]
  },
  {
    n: 3,
    title: msg`People`,
    desc: msg`Your team, structure, and access.`,
    rows: [
      {
        key: "employees",
        object: msg`Employees`,
        detail: msg`The people on your team and their access to Carbon`
      },
      {
        key: "departments",
        object: msg`Departments`,
        detail: msg`How your team is organized into departments`
      },
      {
        key: "shifts",
        object: msg`Shifts`,
        detail: msg`The working hours and calendars that drive scheduling`
      },
      {
        key: "holidays",
        object: msg`Holidays`,
        detail: msg`Non-working days that scheduling and capacity respect`
      },
      {
        key: "attributes",
        object: msg`Attributes`,
        detail: msg`Custom attributes you track against your people`
      },
      {
        key: "employee-types",
        object: msg`Employee Types`,
        detail: msg`Roles that set default permissions for new employees`
      },
      {
        key: "groups",
        object: msg`Groups`,
        detail: msg`Permission groups for granting access in bulk`
      }
    ]
  },
  {
    n: 4,
    title: msg`Items`,
    desc: msg`Parts, materials, and how you classify them.`,
    rows: [
      {
        key: "units",
        object: msg`Units`,
        detail: msg`The units of measure you buy, stock, and sell in`,
        moduleTags: ["itm"]
      },
      {
        key: "item-groups",
        object: msg`Item Groups`,
        detail: msg`How items roll up for posting and reporting`,
        moduleTags: ["itm"]
      },
      {
        key: "parts",
        object: msg`Parts`,
        detail: msg`Your part numbers and the item master behind them`,
        moduleTags: ["itm"]
      },
      {
        key: "materials",
        object: msg`Materials`,
        detail: msg`The raw stock and material master you buy and consume`,
        moduleTags: ["itm"]
      },
      {
        key: "tools",
        object: msg`Tools`,
        detail: msg`The tooling and fixtures your operations rely on`,
        moduleTags: ["itm"]
      },
      {
        key: "consumables",
        object: msg`Consumables`,
        detail: msg`The shop supplies and consumables you keep on hand`,
        moduleTags: ["itm"]
      },
      {
        key: "material-substances",
        object: msg`Substances`,
        detail: msg`The substances your materials are made of`,
        moduleTags: ["itm"]
      },
      {
        key: "material-shapes",
        object: msg`Shapes`,
        detail: msg`The forms and shapes your raw materials come in`,
        moduleTags: ["itm"]
      },
      {
        key: "material-grades",
        object: msg`Grades`,
        detail: msg`The grades that classify your materials`,
        moduleTags: ["itm"]
      },
      {
        key: "material-finishes",
        object: msg`Finishes`,
        detail: msg`The surface finishes available on your materials`,
        moduleTags: ["itm"]
      },
      {
        key: "material-dimensions",
        object: msg`Dimensions`,
        detail: msg`The standard dimensions your materials are stocked in`,
        moduleTags: ["itm"]
      },
      {
        key: "material-types",
        object: msg`Material Types`,
        detail: msg`The material types you organize your stock by`,
        moduleTags: ["itm"]
      }
    ]
  },
  {
    n: 5,
    title: msg`Sales`,
    desc: msg`Who you sell to and at what price.`,
    rows: [
      {
        key: "customers",
        object: msg`Customers`,
        detail: msg`The customers you sell and ship to`,
        moduleTags: ["sal"]
      },
      {
        key: "customer-types",
        object: msg`Customer Types`,
        detail: msg`Segments that drive customer pricing and terms`,
        moduleTags: ["sal"]
      },
      {
        key: "customer-statuses",
        object: msg`Customer Statuses`,
        detail: msg`The lifecycle stages you track customers through`,
        moduleTags: ["sal"]
      },
      {
        key: "price-lists",
        object: msg`Price Lists`,
        detail: msg`Your customer-facing price lists`,
        moduleTags: ["sal"]
      },
      {
        key: "pricing-rules",
        object: msg`Pricing Rules`,
        detail: msg`Rules that adjust prices automatically by quantity or customer`,
        moduleTags: ["sal"]
      },
      {
        key: "no-quote-reasons",
        object: msg`No Quote Reasons`,
        detail: msg`The reasons you record when you decline an RFQ`,
        moduleTags: ["sal"]
      }
    ]
  },
  {
    n: 6,
    title: msg`Purchasing`,
    desc: msg`Who you buy from.`,
    rows: [
      {
        key: "suppliers",
        object: msg`Suppliers`,
        detail: msg`The suppliers and vendors you buy from`,
        moduleTags: ["pur"]
      },
      {
        key: "supplier-types",
        object: msg`Supplier Types`,
        detail: msg`The categories you group your suppliers into`,
        moduleTags: ["pur"]
      }
    ]
  },
  {
    n: 7,
    title: msg`Inventory`,
    desc: msg`Where stock lives and how it ships.`,
    rows: [
      {
        key: "storage-units",
        object: msg`Storage Units`,
        detail: msg`The shelves and bins where stock physically sits`,
        moduleTags: ["inv"]
      },
      {
        key: "storage-types",
        object: msg`Storage Types`,
        detail: msg`Categories that classify how stock is stored`,
        moduleTags: ["inv"]
      },
      {
        key: "storage-rules",
        object: msg`Storage Rules`,
        detail: msg`Rules that decide where each item gets stored`,
        moduleTags: ["inv"]
      },
      {
        key: "shipping-methods",
        object: msg`Shipping Methods`,
        detail: msg`The carriers and methods you ship orders with`,
        moduleTags: ["inv"]
      }
    ]
  },
  {
    n: 8,
    title: msg`Accounting`,
    desc: msg`Your books and how money flows.`,
    rows: [
      {
        key: "chart-of-accounts",
        object: msg`Chart of Accounts`,
        detail: msg`Your general-ledger accounts and their structure`,
        moduleTags: ["acc"]
      },
      {
        key: "default-accounts",
        object: msg`Default Accounts`,
        detail: msg`The accounts Carbon posts to automatically`,
        moduleTags: ["acc"]
      },
      {
        key: "cost-centers",
        object: msg`Cost Centers`,
        detail: msg`The buckets you track costs against`,
        moduleTags: ["acc"]
      },
      {
        key: "accounting-dimensions",
        object: msg`Dimensions`,
        detail: msg`Extra tags for slicing your GL reporting`,
        moduleTags: ["acc"]
      },
      {
        key: "payment-terms",
        object: msg`Payment Terms`,
        detail: msg`Payment terms like Net 30 or due on receipt`,
        moduleTags: ["acc"]
      },
      {
        key: "exchange-rates",
        object: msg`Exchange Rates`,
        detail: msg`The currencies you trade in and their rates`,
        moduleTags: ["acc"]
      },
      {
        key: "fiscal-year",
        object: msg`Fiscal Year`,
        detail: msg`Your fiscal year and its accounting periods`,
        moduleTags: ["acc"]
      },
      {
        key: "asset-classes",
        object: msg`Asset Classes`,
        detail: msg`The categories your fixed assets fall into`,
        moduleTags: ["acc"]
      }
    ]
  },
  {
    n: 9,
    title: msg`Production`,
    desc: msg`Shop-floor configuration.`,
    rows: [
      {
        key: "scrap-reasons",
        object: msg`Scrap Reasons`,
        detail: msg`The reasons you record when parts get scrapped`,
        moduleTags: ["prd"]
      }
    ]
  }
];
