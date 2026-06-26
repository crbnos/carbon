import type { Mod } from "../types";

export interface DataRow {
  key: string; // stable, for the "validated" flag state
  object: string;
  today: string; // "what you call it today" hint
  moduleTags?: Mod[];
}

export interface DataGroup {
  n: number;
  title: string;
  desc: string;
  rows: DataRow[];
}

// Three load groups, in order: foundation first, then master records, then open
// transactions last (at cutover, so they're current). Module-tagged rows drop
// out when their modules are excluded.
export const DATA_GROUPS: DataGroup[] = [
  {
    n: 1,
    title: "Foundation",
    desc: "The reference data everything else hangs off. Loads first.",
    rows: [
      {
        key: "sites",
        object: "Sites & locations",
        today: "Plants, warehouses"
      },
      {
        key: "coa",
        object: "Chart of accounts",
        today: "Your GL accounts",
        moduleTags: ["acc"]
      },
      {
        key: "tax",
        object: "Currencies & tax",
        today: "Tax codes, rates",
        moduleTags: ["acc"]
      },
      { key: "uom", object: "Units of measure", today: "Each, lb, ft…" },
      { key: "roles", object: "User roles", today: "Who can do what" },
      {
        key: "workcenters",
        object: "Work centers",
        today: "Machines, cells, stations",
        moduleTags: ["prd"]
      }
    ]
  },
  {
    n: 2,
    title: "Master records",
    desc: "The catalog you run on. Loads once foundation is in.",
    rows: [
      { key: "parts", object: "Parts & items", today: "Your part numbers" },
      {
        key: "boms",
        object: "BOMs",
        today: "Bills of material",
        moduleTags: ["itm"]
      },
      {
        key: "routings",
        object: "Bill of Process",
        today: "Operations / steps",
        moduleTags: ["itm"]
      },
      {
        key: "customers",
        object: "Customers",
        today: "Your customer list",
        moduleTags: ["sal"]
      },
      {
        key: "suppliers",
        object: "Suppliers",
        today: "Your vendor list",
        moduleTags: ["pur"]
      },
      {
        key: "pricelists",
        object: "Price lists",
        today: "Customer pricing",
        moduleTags: ["sal"]
      }
    ]
  },
  {
    n: 3,
    title: "Open transactions",
    desc: "Loaded last, right at cutover, so balances are current.",
    rows: [
      {
        key: "open-so",
        object: "Open sales orders",
        today: "Unshipped orders",
        moduleTags: ["sal"]
      },
      {
        key: "open-po",
        object: "Open purchase orders",
        today: "Unreceived POs",
        moduleTags: ["pur"]
      },
      {
        key: "open-jobs",
        object: "Open jobs",
        today: "Work in progress",
        moduleTags: ["prd"]
      },
      {
        key: "inventory",
        object: "Inventory balances",
        today: "On-hand counts",
        moduleTags: ["inv"]
      },
      {
        key: "ar",
        object: "Open AR",
        today: "Money owed to you",
        moduleTags: ["acc"]
      },
      {
        key: "ap",
        object: "Open AP",
        today: "Money you owe",
        moduleTags: ["acc"]
      }
    ]
  }
];
