import type { ChangeOrderData, ChangeOrderSpec } from "../../types.ts";

export const CHANGE_ORDERS: ChangeOrderSpec[] = [
  {
    ref: "co:draft",
    name: "ROB-2000 Rev A — wrist harness routing update",
    type: "Engineering",
    status: "Draft",
    openDateOffset: -346,
    affectedItems: [
      {
        item: "ROB-2000",
        changeType: "Version",
        sortOrder: 1
      }
    ]
  },
  {
    ref: "co:impl",
    name: "CTRL-100 cabinet revision — EMI mitigation on the backplane",
    type: "Engineering",
    status: "Implementation",
    openDateOffset: -307,
    affectedItems: [
      {
        item: "CTRL-100",
        changeType: "Revision",
        sortOrder: 1,
        supersessionMode: "Consume First",
        discontinuationOffset: 48,
        successorEffectivityOffset: 49,
        revision: {
          revision: "A",
          unitSalePrice: 12200,
          description:
            "Rev A — a purchased shielded enclosure, shielded backplane wiring and one consolidated safety I/O board remove the EMI fault path",
          bomEdits: [
            { op: "delete", component: "MAT-STEEL-SHT" },
            { op: "setQuantity", component: "PCB-IO-R1", quantity: 1 },
            { op: "add", component: "MAT-CBL-16AWG", quantity: 18, order: 5 }
          ],
          operationEdits: [
            {
              order: 2,
              description:
                "Mount drives, boards and wire the shielded backplane",
              laborTime: 6
            }
          ]
        }
      }
    ]
  },
  {
    ref: "co:done",
    name: "Introduce the J1 base assembly under change control",
    type: "Engineering",
    status: "Done",
    openDateOffset: -377,
    affectedItems: [
      {
        item: "ARM-BASE-001",
        changeType: "New Part",
        sortOrder: 1
      }
    ]
  },
  // ── Lifecycle-only notices: no affected items yet (every change type spins a
  // method draft), so they exercise the stage flow + action tasks alone.
  {
    ref: "co:start",
    name: "Add a strain-relief clip at the J4 harness exit",
    type: "Engineering",
    changeOrderType: "Design Improvement",
    status: "Start",
    priority: "Medium",
    openDateOffset: -9,
    dueDateOffset: 30,
    reasonForChange:
      "Life testing showed the arm harness flexing past its minimum bend radius where it exits the J4 housing.",
    affectedItems: [],
    actionTasks: [
      { action: "Engineering Review", status: "In Progress", dueDateOffset: 5 },
      { action: "Update Drawings / CAD", status: "Pending", dueDateOffset: 20 }
    ]
  },
  {
    ref: "co:eng-complete",
    name: "Add a lost-motion bench test to the harmonic gear set receiving plan",
    type: "Manufacturing",
    changeOrderType: "Quality / Reliability Improvement",
    status: "Engineering Complete",
    priority: "High",
    openDateOffset: -70,
    dueDateOffset: 14,
    reasonForChange:
      "The Torqline gear-set escape showed certificate review alone cannot catch lost motion over the 1.0 arc-min limit.",
    nonConformance: "ncr:gear-lost-motion",
    affectedItems: [],
    actionTasks: [
      {
        action: "Quality Review",
        status: "Completed",
        dueDateOffset: -45,
        completedOffset: -48
      },
      {
        action: "Notify Affected Parties",
        status: "In Progress",
        dueDateOffset: 7
      }
    ]
  },
  {
    ref: "co:cancelled",
    name: "Update the servo drive wiring diagram for a revised STO terminal layout",
    type: "Documentation",
    changeOrderType: "Documentation Error / Correction",
    status: "Cancelled",
    priority: "Low",
    openDateOffset: -120,
    reasonForChange:
      "Kestrel proposed moving the safe-torque-off terminals on the DRV-SRV-400; they later withdrew it and kept the existing pinout.",
    affectedItems: [],
    actionTasks: [
      {
        action: "Cost Impact Review",
        status: "Completed",
        dueDateOffset: -110,
        completedOffset: -112
      },
      { action: "Update Drawings / CAD", status: "Skipped" }
    ]
  }
];

export const roboticsChangeOrders: ChangeOrderData = {
  changeOrders: CHANGE_ORDERS
};
