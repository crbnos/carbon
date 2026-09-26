import type { ChangeOrderData, ChangeOrderSpec } from "../../types.ts";

export const CHANGE_ORDERS: ChangeOrderSpec[] = [
  {
    ref: "co:draft",
    name: "HMA-4000 Rev A — customer print revision, port relocation",
    type: "Engineering",
    status: "Draft",
    openDateOffset: -220,
    affectedItems: [
      {
        item: "HMA-4000",
        changeType: "Version",
        sortOrder: 1
      }
    ]
  },
  {
    ref: "co:impl",
    name: "MCH-HSG-PUMP revision — single bearing arrangement",
    type: "Engineering",
    status: "Implementation",
    openDateOffset: -190,
    affectedItems: [
      {
        item: "MCH-HSG-PUMP",
        changeType: "Revision",
        sortOrder: 1,
        supersessionMode: "Consume First",
        discontinuationOffset: 45,
        successorEffectivityOffset: 46,
        revision: {
          revision: "A",
          unitSalePrice: 1210,
          description:
            "Rev A — the needle bearing is dropped for a third ball bearing and a face seal, removing the press-fit rework loop at op 2",
          bomEdits: [
            { op: "delete", component: "BRG-NDL-HK1512" },
            { op: "setQuantity", component: "BRG-DBL-6205", quantity: 3 },
            { op: "add", component: "SEAL-ORING-224", quantity: 4, order: 6 }
          ],
          operationEdits: [
            {
              order: 2,
              description:
                "Op 2 — finish the bearing bore, seal counterbore and mounting face",
              laborTime: 2.25
            }
          ]
        }
      }
    ]
  },
  {
    ref: "co:done",
    name: "Introduce the welded base frame under change control",
    type: "Engineering",
    status: "Done",
    openDateOffset: -260,
    affectedItems: [
      {
        item: "FAB-BASE-WLD",
        changeType: "New Part",
        sortOrder: 1
      }
    ]
  },
  // Lifecycle-only notices: no affected items yet (every change type spins a
  // method draft), so they exercise the stage flow + action tasks alone.
  {
    ref: "co:start",
    name: "Add lead-in chamfer to the pump housing needle-bearing bore",
    type: "Engineering",
    changeOrderType: "Design Improvement",
    status: "Start",
    priority: "Medium",
    openDateOffset: -10,
    dueDateOffset: 30,
    reasonForChange:
      "Assembly is shaving the drawn cup on press-in because the bore has only a break-edge; a 15° lead-in chamfer would guide the cup square.",
    affectedItems: [],
    actionTasks: [
      { action: "Engineering Review", status: "In Progress", dueDateOffset: 5 },
      { action: "Update Drawings / CAD", status: "Pending", dueDateOffset: 20 }
    ]
  },
  {
    ref: "co:eng-complete",
    name: "Add 100% ring-gauge check of HK1512 cup OD to the receiving plan",
    type: "Manufacturing",
    changeOrderType: "Quality / Reliability Improvement",
    status: "Engineering Complete",
    priority: "High",
    openDateOffset: -58,
    dueDateOffset: 14,
    reasonForChange:
      "The Midway needle-bearing escape showed an AQL sample of three cannot reliably catch an oversize drawn cup before it reaches the press.",
    nonConformance: "ncr:needle-od",
    affectedItems: [],
    actionTasks: [
      {
        action: "Quality Review",
        status: "Completed",
        dueDateOffset: -44,
        completedOffset: -46
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
    name: "Correct the port thread callout on the manifold end cap drawing",
    type: "Documentation",
    changeOrderType: "Documentation Error / Correction",
    status: "Cancelled",
    priority: "Low",
    openDateOffset: -130,
    reasonForChange:
      "Cedar Valley flagged a 1/4 NPT vs. SAE-6 ORB mismatch on MCH-END-CAP; their copy turned out to be a superseded print and our drawing was already correct.",
    affectedItems: [],
    actionTasks: [
      {
        action: "Engineering Review",
        status: "Completed",
        dueDateOffset: -120,
        completedOffset: -124
      },
      { action: "Update Drawings / CAD", status: "Skipped" }
    ]
  }
];

export const precisionChangeOrders: ChangeOrderData = {
  changeOrders: CHANGE_ORDERS
};
