import type { ChangeOrderData, ChangeOrderSpec } from "../../types.ts";

export const CHANGE_ORDERS: ChangeOrderSpec[] = [
  {
    ref: "co:draft",
    name: "SAT-1000 Rev A — antenna pointing mechanism update",
    type: "Engineering",
    status: "Draft",
    openDateOffset: -346,
    affectedItems: [
      {
        item: "SAT-1000",
        changeType: "Version",
        sortOrder: 1
      }
    ]
  },
  {
    ref: "co:impl",
    name: "EPS-001 harness connector revision — short circuit mitigation",
    type: "Engineering",
    status: "Implementation",
    openDateOffset: -307,
    affectedItems: [
      {
        item: "EPS-001",
        changeType: "Revision",
        sortOrder: 1,
        supersessionMode: "Consume First",
        discontinuationOffset: 48,
        successorEffectivityOffset: 49,
        revision: {
          revision: "A",
          unitSalePrice: 120000,
          description:
            "Rev A — potted connector backshells and a revised harness remove the short-circuit path",
          bomEdits: [
            { op: "delete", component: "MAT-KAPTON" },
            { op: "setQuantity", component: "BAT-LIION-48V", quantity: 2 },
            { op: "add", component: "HARNESS-001", quantity: 1, order: 5 }
          ],
          operationEdits: [
            {
              order: 2,
              description: "EPS functional & hipot test",
              laborTime: 3
            }
          ]
        }
      }
    ]
  },
  {
    ref: "co:done",
    name: "Introduce bus primary structure under change control",
    type: "Engineering",
    status: "Done",
    openDateOffset: -377,
    affectedItems: [
      {
        item: "BUS-STR-001",
        changeType: "New Part",
        sortOrder: 1
      }
    ]
  }
];

export const satelliteChangeOrders: ChangeOrderData = {
  changeOrders: CHANGE_ORDERS
};
