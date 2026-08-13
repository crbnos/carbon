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
  }
];

export const motorChangeOrders: ChangeOrderData = {
  changeOrders: CHANGE_ORDERS
};
