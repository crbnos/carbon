import type { ChangeOrderData, ChangeOrderSpec } from "../../types.ts";

export const CHANGE_ORDERS: ChangeOrderSpec[] = [
  {
    ref: "co:draft",
    name: "MTR-9000 Rev A — encoder mount and cable gland relocation",
    type: "Engineering",
    status: "Draft",
    openDateOffset: -346,
    affectedItems: [
      {
        item: "MTR-9000",
        changeType: "Version",
        sortOrder: 1
      }
    ]
  },
  {
    ref: "co:impl",
    name: "STA-9000 revision — Class H insulation system upgrade",
    type: "Engineering",
    status: "Implementation",
    openDateOffset: -307,
    affectedItems: [
      {
        item: "STA-9000",
        changeType: "Revision",
        sortOrder: 1,
        supersessionMode: "Consume First",
        discontinuationOffset: 48,
        successorEffectivityOffset: 49,
        revision: {
          revision: "A",
          unitSalePrice: 1265,
          description:
            "Rev A — heavier varnish fill and phase separators replace the loose slot liner, lifting the winding to a full Class H system",
          bomEdits: [
            { op: "delete", component: "MAT-INS-NOMEX" },
            { op: "setQuantity", component: "MAT-VARNISH", quantity: 0.375 },
            { op: "add", component: "MAT-CU-18AWG", quantity: 1.5, order: 5 }
          ],
          operationEdits: [
            {
              order: 2,
              description:
                "Vacuum-pressure impregnate and bake Class H varnish",
              laborTime: 8
            }
          ]
        }
      }
    ]
  },
  {
    ref: "co:done",
    name: "Introduce the 4500-frame stator under change control",
    type: "Engineering",
    status: "Done",
    openDateOffset: -377,
    affectedItems: [
      {
        item: "STA-4500",
        changeType: "New Part",
        sortOrder: 1
      }
    ]
  },
  // ── Lifecycle-only notices: no affected items yet (every change type spins a
  // method draft), so they exercise the stage flow + action tasks alone.
  {
    ref: "co:start",
    name: "Add strain-relief boss at the HSG-9000 encoder cable exit",
    type: "Engineering",
    changeOrderType: "Design Improvement",
    status: "Start",
    priority: "Medium",
    openDateOffset: -9,
    dueDateOffset: 30,
    reasonForChange:
      "Dyno vibration runs showed the encoder cable flexing at the end-bell exit; two line-driver conductors fatigued inside the jacket.",
    affectedItems: [],
    actionTasks: [
      { action: "Engineering Review", status: "In Progress", dueDateOffset: 5 },
      { action: "Update Drawings / CAD", status: "Pending", dueDateOffset: 20 }
    ]
  },
  {
    ref: "co:eng-complete",
    name: "Add slot-liner thickness check to the Nomex receiving plan",
    type: "Manufacturing",
    changeOrderType: "Quality / Reliability Improvement",
    status: "Engineering Complete",
    priority: "High",
    openDateOffset: -60,
    dueDateOffset: 14,
    reasonForChange:
      "The Copperline Nomex escape showed a label and cert review alone cannot catch under-thickness slot liner before it reaches the winding line.",
    nonConformance: "ncr:nomex-thin",
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
    name: "Revise the TD-4500 nameplate drawing for a dual-voltage rating",
    type: "Documentation",
    changeOrderType: "Documentation Error / Correction",
    status: "Cancelled",
    priority: "Low",
    openDateOffset: -120,
    reasonForChange:
      "Sales asked for a 230/460 V dual rating on the TD-4500; the customer later standardized on 460 V only and the single-voltage plate stays.",
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

export const motorChangeOrders: ChangeOrderData = {
  changeOrders: CHANGE_ORDERS
};
