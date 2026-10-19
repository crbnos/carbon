// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { SyncedEntityType, SyncedField } from "./types";

/**
 * A Carbon table whose rows can link to a Linear or Jira issue, and the
 * columns the sync reads and writes on it.
 */
export type SyncedEntity = {
  table: SyncedEntityType;
  /** The column that names the parent record (the NCR, the change notice). */
  parentColumn: string;
  /** The parent table, and its readable id column for the back-link title. */
  parentTable: string;
  readableColumn: string;
  /** The rich-text column (Tiptap JSON) that syncs with the issue description. */
  textColumn: string;
  assigneeColumn: string;
  dueDateColumn: string;
  /** The fields this record type syncs. */
  fields: SyncedField[];
  /** The permission a user needs to link or unlink the record. */
  permissions: { update: string };
  /** The Carbon page for the record, for the back-link on the issue. */
  detailPath: (parentId: string, id: string) => string;
};

const TASK_FIELDS: SyncedField[] = [
  "status",
  "assignee",
  "dueDate",
  "description"
];

export const syncedEntities: Record<SyncedEntityType, SyncedEntity> = {
  nonConformanceActionTask: {
    table: "nonConformanceActionTask",
    parentColumn: "nonConformanceId",
    parentTable: "nonConformance",
    readableColumn: "nonConformanceId",
    textColumn: "notes",
    assigneeColumn: "assignee",
    dueDateColumn: "dueDate",
    fields: TASK_FIELDS,
    permissions: { update: "quality" },
    detailPath: (parentId) => `/x/issue/${parentId}/details`
  },
  changeOrderActionTask: {
    table: "changeOrderActionTask",
    parentColumn: "changeOrderId",
    parentTable: "changeOrder",
    readableColumn: "changeOrderId",
    textColumn: "notes",
    assigneeColumn: "assignee",
    dueDateColumn: "dueDate",
    fields: TASK_FIELDS,
    permissions: { update: "parts" },
    detailPath: (parentId) => `/x/items/change-notice/${parentId}/details`
  }
};

export function isSyncedEntityType(
  value: string | null | undefined
): value is SyncedEntityType {
  return !!value && Object.hasOwn(syncedEntities, value);
}

export function syncedEntityPermissions(entityType: SyncedEntityType): {
  update?: string;
} {
  return syncedEntities[entityType].permissions;
}

export function syncedEntityParentId(
  rows: unknown,
  entityType: SyncedEntityType
): string | null {
  // The services select the parent column dynamically, which erases Supabase's row typing
  return (
    (rows as Record<string, string | null>[] | null)?.[0]?.[
      syncedEntities[entityType].parentColumn
    ] ?? null
  );
}
