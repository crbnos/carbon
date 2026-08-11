import type { Database } from "@carbon/database";
import type { ActionTaskEntityType } from "@carbon/ee/action-task-entity";
import { actionTaskEntities } from "@carbon/ee/action-task-entity";
import type { SupabaseClient } from "@supabase/supabase-js";

// The readable identifier on each action task's parent, used for the Linear
// attachment / Jira remote-link title.
const actionTaskParents: Record<
  ActionTaskEntityType,
  { parentTable: string; readableColumn: string }
> = {
  nonConformanceActionTask: {
    parentTable: "nonConformance",
    readableColumn: "nonConformanceId"
  },
  changeOrderActionTask: {
    parentTable: "changeOrder",
    readableColumn: "changeOrderId"
  }
};

export type ActionTaskWithParent = {
  id: string | null;
  notes: unknown;
  parentId: string | null;
  parentReadableId: string | null;
};

// Entity-aware action-task read: resolves the task plus its parent (NCR or change notice) — reads an action
// task and its parent's readable id from whichever table the entity type names.
export async function getActionTaskWithParent(
  client: SupabaseClient<Database>,
  entityType: ActionTaskEntityType,
  taskId: string,
  companyId: string
): Promise<ActionTaskWithParent> {
  const { table, parentColumn } = actionTaskEntities[entityType];
  const { parentTable, readableColumn } = actionTaskParents[entityType];

  const result = await client
    .from(table)
    .select(`id, notes, ${parentColumn}, ${parentTable}(${readableColumn})`)
    .eq("id", taskId)
    .eq("companyId", companyId)
    .maybeSingle();

  // The select string is built from the entity map, which erases Supabase's row typing
  const row = result.data as Record<string, any> | null;

  return {
    id: row?.id ?? null,
    notes: row?.notes ?? null,
    parentId: row?.[parentColumn] ?? null,
    parentReadableId: row?.[parentTable]?.[readableColumn] ?? null
  };
}
