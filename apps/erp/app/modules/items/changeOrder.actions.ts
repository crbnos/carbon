import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import type { changeOrderTaskStatus } from "./changeOrder.models";

// =============================================================================
// Change Orders — Actions (freeform tasks; reuse changeOrderActionTask). Any
// user, any stage; non-gating. Split out of changeOrder.service.ts to keep
// each file focused and under the module's 1000-line budget (G4).
// =============================================================================
export async function getChangeOrderActions(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
) {
  return client
    .from("changeOrderActionTask")
    .select("*")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function updateChangeOrderActionStatus(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    status: (typeof changeOrderTaskStatus)[number];
    userId: string;
  }
) {
  const today = new Date().toISOString().split("T")[0];
  return client
    .from("changeOrderActionTask")
    .update({
      status: input.status,
      completedDate: input.status === "Completed" ? today : null,
      updatedBy: input.userId
    })
    .eq("id", input.id)
    .select("id")
    .single();
}

export async function deleteChangeOrderAction(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderActionTask").delete().eq("id", id);
}

// Bulk reorder (drag-sort) — a multi-row write, so Kysely (route passes
// getDatabaseClient()).
export async function updateChangeOrderActionOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("changeOrderActionTask")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}

// =============================================================================
// Change Order Required Actions (the configurable default-action templates the
// config CRUD page manages, and the source new change orders are seeded from).
// =============================================================================
export async function getChangeOrderRequiredActions(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("changeOrderRequiredAction")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getChangeOrderRequiredActionsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("changeOrderRequiredAction")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

export async function getChangeOrderRequiredAction(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("changeOrderRequiredAction")
    .select("*")
    .eq("id", id)
    .single();
}

export async function upsertChangeOrderRequiredAction(
  client: SupabaseClient<Database>,
  input: {
    id?: string;
    name: string;
    active: boolean;
    companyId: string;
    userId: string;
  }
) {
  if (input.id) {
    return client
      .from("changeOrderRequiredAction")
      .update({
        name: input.name,
        active: input.active,
        updatedBy: input.userId
      })
      .eq("id", input.id)
      .select("id")
      .single();
  }

  return client
    .from("changeOrderRequiredAction")
    .insert({
      name: input.name,
      active: input.active,
      companyId: input.companyId,
      createdBy: input.userId
    })
    .select("id")
    .single();
}

export async function deleteChangeOrderRequiredAction(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderRequiredAction").delete().eq("id", id);
}

// Reconcile a change order's action tasks to a chosen set of required-action
// templates — the sidebar's editable "Required Actions" multiselect (mirrors
// Quality's requiredActionIds field). Templates newly selected are instantiated
// (appended); templates deselected have their task removed. Tasks with no
// template link (actionTypeId IS NULL) are left untouched.
export async function setChangeOrderActionTasks(
  client: SupabaseClient<Database>,
  input: {
    changeOrderId: string;
    requiredActionIds: string[];
    companyId: string;
    userId: string;
  }
) {
  const existing = await client
    .from("changeOrderActionTask")
    .select("id, actionTypeId, sortOrder")
    .eq("changeOrderId", input.changeOrderId)
    .eq("companyId", input.companyId);
  if (existing.error) return existing;

  const rows = existing.data ?? [];
  const desired = new Set(input.requiredActionIds);
  const linked = new Set(
    rows.map((r) => r.actionTypeId).filter((id): id is string => Boolean(id))
  );

  const toRemove = rows
    .filter((r) => r.actionTypeId && !desired.has(r.actionTypeId))
    .map((r) => r.id);
  if (toRemove.length > 0) {
    const del = await client
      .from("changeOrderActionTask")
      .delete()
      .in("id", toRemove);
    if (del.error) return del;
  }

  const toAddIds = input.requiredActionIds.filter((id) => !linked.has(id));
  if (toAddIds.length > 0) {
    const templates = await client
      .from("changeOrderRequiredAction")
      .select("id, name")
      .in("id", toAddIds)
      .eq("companyId", input.companyId);
    if (templates.error) return templates;

    const base = rows.reduce((max, r) => Math.max(max, r.sortOrder ?? 0), 0);
    const ins = await client.from("changeOrderActionTask").insert(
      (templates.data ?? []).map((template, index) => ({
        changeOrderId: input.changeOrderId,
        actionTypeId: template.id,
        name: template.name,
        status: "Pending" as const,
        sortOrder: base + index + 1,
        companyId: input.companyId,
        createdBy: input.userId
      }))
    );
    if (ins.error) return ins;
  }

  return { data: null, error: null };
}

// Instantiate one changeOrderActionTask per active template onto a new change
// order. Called by insertChangeOrder; non-gating, so callers ignore a soft
// failure rather than roll back the change order.
export async function seedDefaultChangeOrderActions(
  client: SupabaseClient<Database>,
  input: { changeOrderId: string; companyId: string; userId: string }
) {
  const templates = await getChangeOrderRequiredActionsList(
    client,
    input.companyId
  );
  if (templates.error || !templates.data?.length) return templates;

  return client.from("changeOrderActionTask").insert(
    templates.data.map((template, index) => ({
      changeOrderId: input.changeOrderId,
      actionTypeId: template.id,
      name: template.name,
      status: "Pending" as const,
      sortOrder: index + 1,
      companyId: input.companyId,
      createdBy: input.userId
    }))
  );
}
