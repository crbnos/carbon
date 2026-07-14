import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Mod } from "../types";

export interface DataRow {
  key: string; // stable, for the "validated" flag state
  object: MessageDescriptor;
  today: MessageDescriptor; // "what you call it today" hint
  moduleTags?: Mod[];
}

export interface DataGroup {
  n: number;
  title: MessageDescriptor;
  desc: MessageDescriptor;
  rows: DataRow[];
}

// Three load groups, in order: foundation first, then master records, then open
// transactions last (at cutover, so they're current). Module-tagged rows drop
// out when their modules are excluded.
export const DATA_GROUPS: DataGroup[] = [
  {
    n: 1,
    title: msg`Foundation`,
    desc: msg`The reference data everything else hangs off. Loads first.`,
    rows: [
      {
        key: "sites",
        object: msg`Sites & locations`,
        today: msg`Plants, warehouses`
      },
      {
        key: "coa",
        object: msg`Chart of accounts`,
        today: msg`Your GL accounts`,
        moduleTags: ["acc"]
      },
      {
        key: "tax",
        object: msg`Currencies & tax`,
        today: msg`Tax codes, rates`,
        moduleTags: ["acc"]
      },
      { key: "uom", object: msg`Units of measure`, today: msg`Each, lb, ft…` },
      { key: "roles", object: msg`User roles`, today: msg`Who can do what` },
      {
        key: "workcenters",
        object: msg`Work centers`,
        today: msg`Machines, cells, stations`,
        moduleTags: ["prd"]
      }
    ]
  },
  {
    n: 2,
    title: msg`Master records`,
    desc: msg`The catalog you run on. Loads once foundation is in.`,
    rows: [
      {
        key: "parts",
        object: msg`Parts & items`,
        today: msg`Your part numbers`
      },
      {
        key: "boms",
        object: msg`BOMs`,
        today: msg`Bills of material`,
        moduleTags: ["itm"]
      },
      {
        key: "routings",
        object: msg`Bill of Process`,
        today: msg`Operations / steps`,
        moduleTags: ["itm"]
      },
      {
        key: "customers",
        object: msg`Customers`,
        today: msg`Your customer list`,
        moduleTags: ["sal"]
      },
      {
        key: "suppliers",
        object: msg`Suppliers`,
        today: msg`Your vendor list`,
        moduleTags: ["pur"]
      },
      {
        key: "pricelists",
        object: msg`Price lists`,
        today: msg`Customer pricing`,
        moduleTags: ["sal"]
      }
    ]
  },
  {
    n: 3,
    title: msg`Open transactions`,
    desc: msg`Loaded last, right at cutover, so balances are current.`,
    rows: [
      {
        key: "open-so",
        object: msg`Open sales orders`,
        today: msg`Unshipped orders`,
        moduleTags: ["sal"]
      },
      {
        key: "open-po",
        object: msg`Open purchase orders`,
        today: msg`Unreceived POs`,
        moduleTags: ["pur"]
      },
      {
        key: "open-jobs",
        object: msg`Open jobs`,
        today: msg`Work in progress`,
        moduleTags: ["prd"]
      },
      {
        key: "inventory",
        object: msg`Inventory balances`,
        today: msg`On-hand counts`,
        moduleTags: ["inv"]
      },
      {
        key: "ar",
        object: msg`Open AR`,
        today: msg`Money owed to you`,
        moduleTags: ["acc"]
      },
      {
        key: "ap",
        object: msg`Open AP`,
        today: msg`Money you owe`,
        moduleTags: ["acc"]
      }
    ]
  }
];
