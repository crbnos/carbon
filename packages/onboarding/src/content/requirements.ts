import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Mod } from "../types";

export interface ReqRow {
  code: string; // Module.Area.Number, e.g. SAL.QT.01
  requirement: MessageDescriptor;
}

export interface ReqArea {
  code: string;
  name: MessageDescriptor;
  rows: ReqRow[];
}

export interface ReqModule {
  mod: Mod;
  code: string;
  name: MessageDescriptor;
  areas: ReqArea[];
}

// The requirements backbone: 27 rows across the seven Carbon modules
// (order per RESTRUCTURE_SPEC). Excluded modules drop their whole section.
export const REQUIREMENTS: ReqModule[] = [
  {
    mod: "sal",
    code: "SAL",
    name: msg`Sales`,
    areas: [
      {
        code: "SAL.QT",
        name: msg`Quoting, Orders, Configure-to-Order`,
        rows: [
          {
            code: "SAL.QT.01",
            requirement: msg`Build quotes pulling live part, cost, and Bill of Process data`
          },
          {
            code: "SAL.QT.02",
            requirement: msg`Convert a quote to a sales order with no re-keying`
          },
          {
            code: "SAL.QT.03",
            requirement: msg`Configure-to-order: pick options and price automatically`
          }
        ]
      }
    ]
  },
  {
    mod: "pur",
    code: "PUR",
    name: msg`Purchasing`,
    areas: [
      {
        code: "PUR.PO",
        name: msg`Purchase Orders and Planning`,
        rows: [
          {
            code: "PUR.PO.01",
            requirement: msg`Create and approve purchase orders`
          },
          {
            code: "PUR.PO.02",
            requirement: msg`Auto-suggest purchases from demand and reorder points`
          },
          {
            code: "PUR.PO.03",
            requirement: msg`Receive against a PO and update inventory`
          }
        ]
      }
    ]
  },
  {
    mod: "inv",
    code: "INV",
    name: msg`Inventory`,
    areas: [
      {
        code: "INV.IC",
        name: msg`Inventory Control`,
        rows: [
          {
            code: "INV.IC.01",
            requirement: msg`Track real-time inventory by location and bin`
          },
          {
            code: "INV.IC.02",
            requirement: msg`Cycle count and adjust with an audit trail`
          },
          {
            code: "INV.IC.03",
            requirement: msg`Show one inventory number the floor and office both trust`
          }
        ]
      }
    ]
  },
  {
    mod: "itm",
    code: "ITM",
    name: msg`Items`,
    areas: [
      {
        code: "ITM.IM",
        name: msg`Item Master and Make Methods`,
        rows: [
          {
            code: "ITM.IM.01",
            requirement: msg`Maintain a single part and item master`
          },
          {
            code: "ITM.IM.02",
            requirement: msg`Define multi-level BOMs and Bill of Process (make methods)`
          }
        ]
      },
      {
        code: "ITM.ENG",
        name: msg`Engineering Changes and CAD`,
        rows: [
          {
            code: "ITM.ENG.01",
            requirement: msg`Control design changes with revisions / ECOs`
          },
          {
            code: "ITM.ENG.02",
            requirement: msg`Native CAD integration (for example Onshape)`
          }
        ]
      }
    ]
  },
  {
    mod: "prd",
    code: "PRD",
    name: msg`Production`,
    areas: [
      {
        code: "PRD.MES",
        name: msg`Shop Floor and Scheduling`,
        rows: [
          {
            code: "PRD.SF.01",
            requirement: msg`Run the floor on tablets: clock labor, report progress, see instructions`
          },
          {
            code: "PRD.SC.01",
            requirement: msg`Schedule jobs against work-center capacity`
          }
        ]
      }
    ]
  },
  {
    mod: "qms",
    code: "QMS",
    name: msg`Quality`,
    areas: [
      {
        code: "QMS",
        name: msg`Inspections, Nonconformance, CAPA`,
        rows: [
          {
            code: "QMS.INS.01",
            requirement: msg`Record inspections tied to a part and a job`
          },
          {
            code: "QMS.NCR.01",
            requirement: msg`Log nonconformances and drive a CAPA`
          },
          {
            code: "QMS.NOT.01",
            requirement: msg`Automate quality flags and notifications`
          }
        ]
      }
    ]
  },
  {
    mod: "acc",
    code: "ACC",
    name: msg`Accounting`,
    areas: [
      {
        code: "ACC.GL",
        name: msg`General Ledger`,
        rows: [
          {
            code: "ACC.GL.01",
            requirement: msg`Post journal entries with proper account and description codes`
          },
          {
            code: "ACC.GL.02",
            requirement: msg`Handle recurring and reversing journal entries`
          },
          {
            code: "ACC.GL.03",
            requirement: msg`Track transactions by segment (cost center, project, service line)`
          },
          {
            code: "ACC.GL.04",
            requirement: msg`Run month-end close and standard reconciliations`
          }
        ]
      },
      {
        code: "ACC.AR",
        name: msg`Accounts Receivable`,
        rows: [
          {
            code: "ACC.AR.01",
            requirement: msg`Generate and send customer invoices`
          },
          {
            code: "ACC.AR.02",
            requirement: msg`Apply payments and track aging`
          },
          {
            code: "ACC.AR.03",
            requirement: msg`Tie shipments through to an invoice with no re-keying`
          }
        ]
      },
      {
        code: "ACC.AP",
        name: msg`Accounts Payable`,
        rows: [
          {
            code: "ACC.AP.01",
            requirement: msg`Enter and approve vendor bills against a PO (three-way match)`
          },
          {
            code: "ACC.AP.02",
            requirement: msg`Run payment batches and track aging`
          }
        ]
      }
    ]
  }
];
