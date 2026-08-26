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
  }
];

export const roboticsChangeOrders: ChangeOrderData = {
  changeOrders: CHANGE_ORDERS
};
