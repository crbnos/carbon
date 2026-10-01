// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ChangeOrderData, ChangeOrderSpec } from "../../types.ts";

export const CHANGE_ORDERS: ChangeOrderSpec[] = [
  {
    ref: "co:draft",
    name: "SAW-001 — cell string layout for higher-efficiency cells",
    type: "Engineering",
    status: "Draft",
    openDateOffset: -346,
    affectedItems: [
      {
        item: "SAW-001",
        changeType: "Version",
        sortOrder: 1
      }
    ]
  },
  {
    ref: "co:impl",
    name: "HARNESS-001 connector revision — short circuit mitigation",
    type: "Engineering",
    status: "Implementation",
    openDateOffset: -307,
    affectedItems: [
      {
        item: "HARNESS-001",
        changeType: "Revision",
        sortOrder: 1,
        supersessionMode: "Consume First",
        discontinuationOffset: 48,
        successorEffectivityOffset: 49,
        revision: {
          revision: "A",
          unitSalePrice: 12600,
          description:
            "Rev A — potted connector backshells replace the screw-clamp strain relief and remove the short-circuit path",
          bomEdits: [
            { op: "delete", component: "FST-M4-TI" },
            { op: "setQuantity", component: "MAT-KAPTON", quantity: 6 },
            { op: "add", component: "MAT-SYLGARD", quantity: 0.25, order: 3 }
          ],
          operationEdits: [
            {
              order: 2,
              description: "Continuity, insulation resistance & hipot test",
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
  },
  // Lifecycle-only notices: no affected items yet (every change type spins a
  // method draft), so they exercise the stage flow + action tasks alone.
  {
    ref: "co:start",
    name: "Relocate EPS connector bracket to clear harness bend radius",
    type: "Engineering",
    changeOrderType: "Design Improvement",
    status: "Start",
    priority: "Medium",
    openDateOffset: -9,
    dueDateOffset: 30,
    reasonForChange:
      "Integration found the EPS harness exceeds its minimum bend radius at the current bracket location.",
    affectedItems: [],
    actionTasks: [
      { action: "Engineering Review", status: "In Progress", dueDateOffset: 5 },
      { action: "Update Drawings / CAD", status: "Pending", dueDateOffset: 20 }
    ]
  },
  {
    ref: "co:eng-complete",
    name: "Add girth-weld UT to the propellant tank receiving plan",
    type: "Manufacturing",
    changeOrderType: "Quality / Reliability Improvement",
    status: "Engineering Complete",
    priority: "High",
    openDateOffset: -70,
    dueDateOffset: 14,
    reasonForChange:
      "The PropTech tank escape showed visual weld inspection alone cannot catch sub-minimum wall thickness.",
    nonConformance: "ncr:tank-wall",
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
    name: "Update star tracker ICD for the revised mounting pattern",
    type: "Documentation",
    changeOrderType: "Documentation Error / Correction",
    status: "Cancelled",
    priority: "Low",
    openDateOffset: -120,
    reasonForChange:
      "Vendor proposed a new ST-050 bolt pattern; they later withdrew it and kept the heritage interface.",
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

export const satelliteChangeOrders: ChangeOrderData = {
  changeOrders: CHANGE_ORDERS
};
