import type { Mod } from "../types";

export interface ReqRow {
  code: string; // Module.Area.Number, e.g. SAL.QT.01
  requirement: string;
}

export interface ReqArea {
  code: string;
  name: string;
  rows: ReqRow[];
}

export interface ReqModule {
  mod: Mod;
  code: string;
  name: string;
  areas: ReqArea[];
}

// The requirements backbone: 27 rows across the seven Carbon modules
// (order per RESTRUCTURE_SPEC). Excluded modules drop their whole section.
export const REQUIREMENTS: ReqModule[] = [
  {
    mod: "sal",
    code: "SAL",
    name: "Sales",
    areas: [
      {
        code: "SAL.QT",
        name: "Quoting, Orders, Configure-to-Order",
        rows: [
          {
            code: "SAL.QT.01",
            requirement:
              "Build quotes pulling live part, cost, and Bill of Process data"
          },
          {
            code: "SAL.QT.02",
            requirement: "Convert a quote to a sales order with no re-keying"
          },
          {
            code: "SAL.QT.03",
            requirement:
              "Configure-to-order: pick options and price automatically"
          }
        ]
      }
    ]
  },
  {
    mod: "pur",
    code: "PUR",
    name: "Purchasing",
    areas: [
      {
        code: "PUR.PO",
        name: "Purchase Orders and Planning",
        rows: [
          {
            code: "PUR.PO.01",
            requirement: "Create and approve purchase orders"
          },
          {
            code: "PUR.PO.02",
            requirement: "Auto-suggest purchases from demand and reorder points"
          },
          {
            code: "PUR.PO.03",
            requirement: "Receive against a PO and update inventory"
          }
        ]
      }
    ]
  },
  {
    mod: "inv",
    code: "INV",
    name: "Inventory",
    areas: [
      {
        code: "INV.IC",
        name: "Inventory Control",
        rows: [
          {
            code: "INV.IC.01",
            requirement: "Track real-time inventory by location and bin"
          },
          {
            code: "INV.IC.02",
            requirement: "Cycle count and adjust with an audit trail"
          },
          {
            code: "INV.IC.03",
            requirement:
              "Show one inventory number the floor and office both trust"
          }
        ]
      }
    ]
  },
  {
    mod: "itm",
    code: "ITM",
    name: "Items",
    areas: [
      {
        code: "ITM.IM",
        name: "Item Master and Make Methods",
        rows: [
          {
            code: "ITM.IM.01",
            requirement: "Maintain a single part and item master"
          },
          {
            code: "ITM.IM.02",
            requirement:
              "Define multi-level BOMs and Bill of Process (make methods)"
          }
        ]
      },
      {
        code: "ITM.ENG",
        name: "Engineering Changes and CAD",
        rows: [
          {
            code: "ITM.ENG.01",
            requirement: "Control design changes with revisions / ECOs"
          },
          {
            code: "ITM.ENG.02",
            requirement: "Native CAD integration (for example Onshape)"
          }
        ]
      }
    ]
  },
  {
    mod: "prd",
    code: "PRD",
    name: "Production",
    areas: [
      {
        code: "PRD.MES",
        name: "Shop Floor and Scheduling",
        rows: [
          {
            code: "PRD.SF.01",
            requirement:
              "Run the floor on tablets: clock labor, report progress, see instructions"
          },
          {
            code: "PRD.SC.01",
            requirement: "Schedule jobs against work-center capacity"
          }
        ]
      }
    ]
  },
  {
    mod: "qms",
    code: "QMS",
    name: "Quality",
    areas: [
      {
        code: "QMS",
        name: "Inspections, Nonconformance, CAPA",
        rows: [
          {
            code: "QMS.INS.01",
            requirement: "Record inspections tied to a part and a job"
          },
          {
            code: "QMS.NCR.01",
            requirement: "Log nonconformances and drive a CAPA"
          },
          {
            code: "QMS.NOT.01",
            requirement: "Automate quality flags and notifications"
          }
        ]
      }
    ]
  },
  {
    mod: "acc",
    code: "ACC",
    name: "Accounting",
    areas: [
      {
        code: "ACC.GL",
        name: "General Ledger",
        rows: [
          {
            code: "ACC.GL.01",
            requirement:
              "Post journal entries with proper account and description codes"
          },
          {
            code: "ACC.GL.02",
            requirement: "Handle recurring and reversing journal entries"
          },
          {
            code: "ACC.GL.03",
            requirement:
              "Track transactions by segment (cost center, project, service line)"
          },
          {
            code: "ACC.GL.04",
            requirement: "Run month-end close and standard reconciliations"
          }
        ]
      },
      {
        code: "ACC.AR",
        name: "Accounts Receivable",
        rows: [
          {
            code: "ACC.AR.01",
            requirement: "Generate and send customer invoices"
          },
          { code: "ACC.AR.02", requirement: "Apply payments and track aging" },
          {
            code: "ACC.AR.03",
            requirement: "Tie shipments through to an invoice with no re-keying"
          }
        ]
      },
      {
        code: "ACC.AP",
        name: "Accounts Payable",
        rows: [
          {
            code: "ACC.AP.01",
            requirement:
              "Enter and approve vendor bills against a PO (three-way match)"
          },
          {
            code: "ACC.AP.02",
            requirement: "Run payment batches and track aging"
          }
        ]
      }
    ]
  }
];
