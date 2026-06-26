import type { Mod } from "../types";

export interface SetupRow {
  key: string; // stable, for the "configured" flag state
  object: string; // the thing to set up (grounded in Carbon's nav labels)
  detail: string; // short "what it is" hint
  moduleTags?: Mod[];
}

export interface SetupGroup {
  n: number;
  title: string; // a Carbon module
  desc: string;
  rows: SetupRow[];
}

// The first-run configuration map, grouped by Carbon module. Every master /
// reference / config entity a new shop sets up before transacting, labelled as
// it appears in that module's navigation. Transactional documents (orders,
// receipts, timecards…) and runtime admin (billing, API keys, webhooks, audit
// logs) are intentionally excluded. Module-tagged rows drop out when their
// module is excluded, so an excluded module's group disappears.
export const SETUP_GROUPS: SetupGroup[] = [
  {
    n: 1,
    title: "Settings",
    desc: "Company identity, documents, and system defaults.",
    rows: [
      {
        key: "company",
        object: "Company",
        detail: "Your legal name, addresses, branding, and document defaults"
      },
      {
        key: "document-templates",
        object: "Document Templates",
        detail: "How your quotes, orders, and invoices look when they go out"
      },
      {
        key: "logos",
        object: "Logos",
        detail: "The logos shown on your printed and emailed documents"
      },
      {
        key: "printing",
        object: "Printing",
        detail: "The label and document printers your shop prints to"
      },
      {
        key: "sequences",
        object: "Sequences",
        detail: "Auto-numbering formats for orders, jobs, parts, and more"
      },
      {
        key: "custom-fields",
        object: "Custom Fields",
        detail: "Extra fields to capture data Carbon doesn't track by default"
      },
      {
        key: "integrations",
        object: "Integrations",
        detail: "Connect the outside tools your shop already runs on"
      },
      {
        key: "approval-rules",
        object: "Approval Rules",
        detail: "Who has to approve quotes, orders, and purchases — and when"
      }
    ]
  },
  {
    n: 2,
    title: "Resources",
    desc: "Where and how you make things.",
    rows: [
      {
        key: "locations",
        object: "Locations",
        detail:
          "The plants, warehouses, and sites where your work and stock live"
      },
      {
        key: "work-centers",
        object: "Work Centers",
        detail: "The machines, cells, and stations your work runs through",
        moduleTags: ["prd"]
      },
      {
        key: "processes",
        object: "Processes",
        detail: "The operations and steps your parts move through",
        moduleTags: ["prd"]
      },
      {
        key: "training",
        object: "Training",
        detail: "The skills and abilities you track for your people"
      },
      {
        key: "failure-modes",
        object: "Failure Modes",
        detail:
          "The ways equipment fails, for maintenance and quality tracking",
        moduleTags: ["prd"]
      },
      {
        key: "maintenance-schedules",
        object: "Maintenance Schedules",
        detail: "Preventive maintenance schedules for your equipment",
        moduleTags: ["prd"]
      }
    ]
  },
  {
    n: 3,
    title: "People",
    desc: "Your team, structure, and access.",
    rows: [
      {
        key: "employees",
        object: "Employees",
        detail: "The people on your team and their access to Carbon"
      },
      {
        key: "departments",
        object: "Departments",
        detail: "How your team is organized into departments"
      },
      {
        key: "shifts",
        object: "Shifts",
        detail: "The working hours and calendars that drive scheduling"
      },
      {
        key: "holidays",
        object: "Holidays",
        detail: "Non-working days that scheduling and capacity respect"
      },
      {
        key: "attributes",
        object: "Attributes",
        detail: "Custom attributes you track against your people"
      },
      {
        key: "employee-types",
        object: "Employee Types",
        detail: "Roles that set default permissions for new employees"
      },
      {
        key: "groups",
        object: "Groups",
        detail: "Permission groups for granting access in bulk"
      }
    ]
  },
  {
    n: 4,
    title: "Items",
    desc: "Parts, materials, and how you classify them.",
    rows: [
      {
        key: "units",
        object: "Units",
        detail: "The units of measure you buy, stock, and sell in",
        moduleTags: ["itm"]
      },
      {
        key: "item-groups",
        object: "Item Groups",
        detail: "How items roll up for posting and reporting",
        moduleTags: ["itm"]
      },
      {
        key: "parts",
        object: "Parts",
        detail: "Your part numbers and the item master behind them",
        moduleTags: ["itm"]
      },
      {
        key: "materials",
        object: "Materials",
        detail: "The raw stock and material master you buy and consume",
        moduleTags: ["itm"]
      },
      {
        key: "tools",
        object: "Tools",
        detail: "The tooling and fixtures your operations rely on",
        moduleTags: ["itm"]
      },
      {
        key: "consumables",
        object: "Consumables",
        detail: "The shop supplies and consumables you keep on hand",
        moduleTags: ["itm"]
      },
      {
        key: "material-substances",
        object: "Substances",
        detail: "The substances your materials are made of",
        moduleTags: ["itm"]
      },
      {
        key: "material-shapes",
        object: "Shapes",
        detail: "The forms and shapes your raw materials come in",
        moduleTags: ["itm"]
      },
      {
        key: "material-grades",
        object: "Grades",
        detail: "The grades that classify your materials",
        moduleTags: ["itm"]
      },
      {
        key: "material-finishes",
        object: "Finishes",
        detail: "The surface finishes available on your materials",
        moduleTags: ["itm"]
      },
      {
        key: "material-dimensions",
        object: "Dimensions",
        detail: "The standard dimensions your materials are stocked in",
        moduleTags: ["itm"]
      },
      {
        key: "material-types",
        object: "Material Types",
        detail: "The material types you organize your stock by",
        moduleTags: ["itm"]
      }
    ]
  },
  {
    n: 5,
    title: "Sales",
    desc: "Who you sell to and at what price.",
    rows: [
      {
        key: "customers",
        object: "Customers",
        detail: "The customers you sell and ship to",
        moduleTags: ["sal"]
      },
      {
        key: "customer-types",
        object: "Customer Types",
        detail: "Segments that drive customer pricing and terms",
        moduleTags: ["sal"]
      },
      {
        key: "customer-statuses",
        object: "Customer Statuses",
        detail: "The lifecycle stages you track customers through",
        moduleTags: ["sal"]
      },
      {
        key: "price-lists",
        object: "Price Lists",
        detail: "Your customer-facing price lists",
        moduleTags: ["sal"]
      },
      {
        key: "pricing-rules",
        object: "Pricing Rules",
        detail:
          "Rules that adjust prices automatically by quantity or customer",
        moduleTags: ["sal"]
      },
      {
        key: "no-quote-reasons",
        object: "No Quote Reasons",
        detail: "The reasons you record when you decline an RFQ",
        moduleTags: ["sal"]
      }
    ]
  },
  {
    n: 6,
    title: "Purchasing",
    desc: "Who you buy from.",
    rows: [
      {
        key: "suppliers",
        object: "Suppliers",
        detail: "The suppliers and vendors you buy from",
        moduleTags: ["pur"]
      },
      {
        key: "supplier-types",
        object: "Supplier Types",
        detail: "The categories you group your suppliers into",
        moduleTags: ["pur"]
      }
    ]
  },
  {
    n: 7,
    title: "Inventory",
    desc: "Where stock lives and how it ships.",
    rows: [
      {
        key: "storage-units",
        object: "Storage Units",
        detail: "The shelves and bins where stock physically sits",
        moduleTags: ["inv"]
      },
      {
        key: "storage-types",
        object: "Storage Types",
        detail: "Categories that classify how stock is stored",
        moduleTags: ["inv"]
      },
      {
        key: "storage-rules",
        object: "Storage Rules",
        detail: "Rules that decide where each item gets stored",
        moduleTags: ["inv"]
      },
      {
        key: "shipping-methods",
        object: "Shipping Methods",
        detail: "The carriers and methods you ship orders with",
        moduleTags: ["inv"]
      }
    ]
  },
  {
    n: 8,
    title: "Accounting",
    desc: "Your books and how money flows.",
    rows: [
      {
        key: "chart-of-accounts",
        object: "Chart of Accounts",
        detail: "Your general-ledger accounts and their structure",
        moduleTags: ["acc"]
      },
      {
        key: "default-accounts",
        object: "Default Accounts",
        detail: "The accounts Carbon posts to automatically",
        moduleTags: ["acc"]
      },
      {
        key: "cost-centers",
        object: "Cost Centers",
        detail: "The buckets you track costs against",
        moduleTags: ["acc"]
      },
      {
        key: "accounting-dimensions",
        object: "Dimensions",
        detail: "Extra tags for slicing your GL reporting",
        moduleTags: ["acc"]
      },
      {
        key: "payment-terms",
        object: "Payment Terms",
        detail: "Payment terms like Net 30 or due on receipt",
        moduleTags: ["acc"]
      },
      {
        key: "exchange-rates",
        object: "Exchange Rates",
        detail: "The currencies you trade in and their rates",
        moduleTags: ["acc"]
      },
      {
        key: "fiscal-year",
        object: "Fiscal Year",
        detail: "Your fiscal year and its accounting periods",
        moduleTags: ["acc"]
      },
      {
        key: "asset-classes",
        object: "Asset Classes",
        detail: "The categories your fixed assets fall into",
        moduleTags: ["acc"]
      }
    ]
  },
  {
    n: 9,
    title: "Production",
    desc: "Shop-floor configuration.",
    rows: [
      {
        key: "scrap-reasons",
        object: "Scrap Reasons",
        detail: "The reasons you record when parts get scrapped",
        moduleTags: ["prd"]
      }
    ]
  }
];
