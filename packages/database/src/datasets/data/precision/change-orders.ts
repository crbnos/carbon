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
  }
];

export const precisionChangeOrders: ChangeOrderData = {
  changeOrders: CHANGE_ORDERS
};
