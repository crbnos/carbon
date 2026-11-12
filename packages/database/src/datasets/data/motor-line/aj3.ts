// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  ItemSpec,
  JobSpec,
  KanbanItemSpec,
  MakeMethodSpec,
  OpeningStockSpec,
  ProcessSpec,
  SerialSequenceSpec,
  ShelfSpec,
  SupplierLinkSpec,
  TrackedStockSpec,
  WarehouseSpec,
  WorkCenterSpec
} from "../../types.ts";

/**
 * The AJ-3 serial motor line that `motor-line` adds on top of `motor`.
 */

export const AJ3_PROCESSES: ProcessSpec[] = [];
export const AJ3_WORK_CENTERS: WorkCenterSpec[] = [];
export const AJ3_WORK_CENTER_PROCESS_LINKS: Array<[string, string]> = [];
export const AJ3_WORK_CENTER_SHIFTS: Array<[string, string]> = [];
export const AJ3_WAREHOUSES: WarehouseSpec[] = [];
export const AJ3_SHELVES: ShelfSpec[] = [];
export const AJ3_MAKE_PARTS: ItemSpec[] = [];
export const AJ3_BUY_PARTS: ItemSpec[] = [];
export const AJ3_METHODS: MakeMethodSpec[] = [];
export const AJ3_SUPPLIER_PARTS: SupplierLinkSpec[] = [];
export const AJ3_OPENING_STOCK: OpeningStockSpec[] = [];
export const AJ3_ON_HAND_TRACKED: TrackedStockSpec[] = [];
export const AJ3_KANBAN_ITEMS: KanbanItemSpec[] = [];
export const AJ3_JOBS: JobSpec[] = [];
export const AJ3_SERIAL_SEQUENCES: SerialSequenceSpec[] = [];
