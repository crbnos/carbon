// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { PageGate } from "@carbon/database/access";

export type ActionTaskEntityType =
  | "nonConformanceActionTask"
  | "changeOrderActionTask";

export const actionTaskEntities: Record<
  ActionTaskEntityType,
  {
    table: ActionTaskEntityType;
    parentColumn: string;
    detailPath: (parentId: string) => string;
  }
> = {
  nonConformanceActionTask: {
    table: "nonConformanceActionTask",
    parentColumn: "nonConformanceId",
    detailPath: (parentId) => `/x/issue/${parentId}`
  },
  changeOrderActionTask: {
    table: "changeOrderActionTask",
    parentColumn: "changeOrderId",
    detailPath: (parentId) => `/x/items/change-notice/${parentId}`
  }
};

export function isActionTaskEntityType(
  value: string | null | undefined
): value is ActionTaskEntityType {
  return !!value && value in actionTaskEntities;
}

export function actionTaskPermissions(
  entityType: ActionTaskEntityType
): PageGate {
  return entityType === "changeOrderActionTask"
    ? { "parts.changeNotices": "Edit" }
    : { "quality.issues": "Edit" };
}

export function actionTaskParentId(
  rows: unknown,
  entityType: ActionTaskEntityType
): string | null {
  // The ee services select the parent column dynamically, which erases Supabase's row typing
  return (
    (rows as Record<string, string | null>[] | null)?.[0]?.[
      actionTaskEntities[entityType].parentColumn
    ] ?? null
  );
}
