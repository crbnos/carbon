// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Dataset } from "../../types.ts";
import { motor } from "../motor/index.ts";
import {
  AJ3_BUY_PARTS,
  AJ3_JOBS,
  AJ3_KANBAN_ITEMS,
  AJ3_MAKE_PARTS,
  AJ3_METHODS,
  AJ3_ON_HAND_TRACKED,
  AJ3_OPENING_STOCK,
  AJ3_PROCESSES,
  AJ3_SERIAL_SEQUENCES,
  AJ3_SHELVES,
  AJ3_SUPPLIER_PARTS,
  AJ3_WAREHOUSES,
  AJ3_WORK_CENTER_PROCESS_LINKS,
  AJ3_WORK_CENTER_SHIFTS,
  AJ3_WORK_CENTERS
} from "./aj3.ts";

/**
 * Dev only: `motor` plus the AJ-3 serial motor line and the line-flow settings
 * (traveler labels, required scans, picking lists on release). No industryId,
 * so onboarding never offers it.
 */
export const motorLine: Dataset = {
  ...motor,
  key: "motor-line",
  label: "Motor line (dev)",
  industryId: null,
  // Reuse the motor CAD model and thumbnails; null industryId keeps onboarding off it.
  assetIndustryId: "automotive_precision",
  foundation: {
    ...motor.foundation,
    processes: [...motor.foundation.processes, ...AJ3_PROCESSES],
    workCenters: [...motor.foundation.workCenters, ...AJ3_WORK_CENTERS],
    workCenterProcessLinks: [
      ...motor.foundation.workCenterProcessLinks,
      ...AJ3_WORK_CENTER_PROCESS_LINKS
    ],
    workCenterShifts: [
      ...motor.foundation.workCenterShifts,
      ...AJ3_WORK_CENTER_SHIFTS
    ],
    warehouses: [...motor.foundation.warehouses, ...AJ3_WAREHOUSES],
    shelves: [...motor.foundation.shelves, ...AJ3_SHELVES],
    lineFlow: {
      travelerLabels: true,
      requireTrackedMaterialsIssued: true,
      autoPickingListOnRelease: true
    }
  },
  items: {
    ...motor.items,
    makeParts: [...motor.items.makeParts, ...AJ3_MAKE_PARTS],
    buyParts: [...motor.items.buyParts, ...AJ3_BUY_PARTS],
    methods: [...motor.items.methods, ...AJ3_METHODS],
    supplierLinks: [...motor.items.supplierLinks, ...AJ3_SUPPLIER_PARTS]
  },
  inventory: {
    ...motor.inventory,
    openingStock: [...motor.inventory.openingStock, ...AJ3_OPENING_STOCK],
    onHandTracked: [...motor.inventory.onHandTracked, ...AJ3_ON_HAND_TRACKED],
    kanbanItems: [...motor.inventory.kanbanItems, ...AJ3_KANBAN_ITEMS]
  },
  production: {
    ...motor.production,
    jobs: [...motor.production.jobs, ...AJ3_JOBS]
  },
  ops: {
    ...motor.ops,
    serialSequences: [...motor.ops.serialSequences, ...AJ3_SERIAL_SEQUENCES]
  }
};
