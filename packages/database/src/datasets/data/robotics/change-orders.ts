import type { ChangeOrderData, ChangeOrderSpec } from "../../types.ts";

export const CHANGE_ORDERS: ChangeOrderSpec[] = [
  {
    ref: "co:draft",
    name: "HRN-ARM-001 — wrist harness routing update",
    type: "Engineering",
    status: "Draft",
    openDateOffset: -346,
    affectedItems: [
      {
        item: "HRN-ARM-001",
        changeType: "Version",
        sortOrder: 1
      }
    ]
  },
  {
    ref: "co:impl",
    name: "PCB-CTRL-R1 revision — EMI mitigation on the motion controller",
    type: "Engineering",
    status: "Implementation",
    openDateOffset: -307,
    affectedItems: [
      {
        item: "PCB-CTRL-R1",
        changeType: "Revision",
        sortOrder: 1,
        supersessionMode: "Consume First",
        discontinuationOffset: 48,
        successorEffectivityOffset: 49,
        revision: {
          revision: "A",
          unitSalePrice: 1030,
          description:
            "Rev A — one consolidated M23 connector and a UV-cured conformal coat stop drive noise coupling onto the encoder lines",
          bomEdits: [
            { op: "setQuantity", component: "MAT-CONN-M23", quantity: 1 },
            { op: "add", component: "MAT-COAT-UV", quantity: 0.125, order: 4 }
          ],
          operationEdits: [
            {
              order: 2,
              description:
                "Hand-solder the shielded connector, conformal coat and UV cure",
              laborTime: 0.75
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
  // Lifecycle-only notices: no affected items yet (every change type spins a
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
