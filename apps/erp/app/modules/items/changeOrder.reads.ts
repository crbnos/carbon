import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { changeOrderOpenStatuses } from "./changeOrder.models";
import { getChangeOrderTypesList } from "./changeOrder.service";

// =============================================================================
// Change Orders — item traceability reads (part/tool ↔ CO) and the linked-NCR
// reverse view. Split out of changeOrder.service.ts to keep each file focused
// and under the module's 1000-line budget (G4).
// =============================================================================

// G6 — the SINGLE canonical "change orders referencing this item" query,
// parameterized by status. The item-detail history (all COs), the open-CO alert
// (open statuses), and the single-open-CO guard all call this — no forked
// implementations. Spans every way a CO references an item in the top-to-bottom
// model: an affected item the user selected to change, a staged BOM component,
// a manual supersession (predecessor or successor), and the reverse link from a
// released revision (`item.changeOrderId`). Scoped by readableId so it matches
// the part across all its revisions. Flat queries + JS union (no embeds —
// TS2589 budget).
export type ChangeOrderForItem = {
  id: string;
  changeOrderId: string;
  name: string;
  status: Database["public"]["Enums"]["changeOrderStatus"];
  changeOrderTypeId: string | null;
  createdAt: string;
};

export async function findChangeOrdersForItem(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    statuses?: Database["public"]["Enums"]["changeOrderStatus"][];
  }
): Promise<{ data: ChangeOrderForItem[]; error: { message: string } | null }> {
  const { itemId, companyId, statuses } = args;

  // Resolve every revision (item row) sharing this part's readableId.
  const item = await client
    .from("item")
    .select("readableId")
    .eq("id", itemId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (item.error) return { data: [], error: item.error };
  if (!item.data?.readableId) return { data: [], error: null };

  const siblings = await client
    .from("item")
    .select("id, changeOrderId")
    .eq("readableId", item.data.readableId)
    .eq("companyId", companyId);
  if (siblings.error) return { data: [], error: siblings.error };
  const itemIds = (siblings.data ?? []).map((s) => s.id);
  if (itemIds.length === 0) return { data: [], error: null };

  // Collect referencing changeOrderIds from every relation. v2: instead of a
  // staged-material mirror, "this item is a component in a CO's edited BOM" is
  // found via methodMaterial rows on CO-owned draft methods (makeMethod with a
  // non-null changeOrderId).
  const [affected, componentMaterials, predecessors, successors] =
    await Promise.all([
      client
        .from("changeOrderAffectedItem")
        .select("changeOrderId")
        .in("itemId", itemIds)
        .eq("companyId", companyId),
      client
        .from("methodMaterial")
        .select("makeMethodId")
        .in("itemId", itemIds)
        .eq("companyId", companyId),
      client
        .from("changeOrderSupersession")
        .select("changeOrderId")
        .in("predecessorItemId", itemIds)
        .eq("companyId", companyId),
      client
        .from("changeOrderSupersession")
        .select("changeOrderId")
        .in("successorItemId", itemIds)
        .eq("companyId", companyId)
    ]);
  if (affected.error) return { data: [], error: affected.error };
  if (componentMaterials.error)
    return { data: [], error: componentMaterials.error };
  if (predecessors.error) return { data: [], error: predecessors.error };
  if (successors.error) return { data: [], error: successors.error };

  // Resolve which of those make methods are CO-owned drafts.
  const makeMethodIds = [
    ...new Set(
      (componentMaterials.data ?? []).map((m) => m.makeMethodId).filter(Boolean)
    )
  ] as string[];
  const coOwnedMethods = makeMethodIds.length
    ? await client
        .from("makeMethod")
        .select("changeOrderId")
        .in("id", makeMethodIds)
        .not("changeOrderId", "is", null)
        .eq("companyId", companyId)
    : { data: [], error: null };
  if (coOwnedMethods.error) return { data: [], error: coOwnedMethods.error };

  const coIds = new Set<string>();
  for (const a of affected.data ?? []) coIds.add(a.changeOrderId);
  for (const m of coOwnedMethods.data ?? []) {
    if (m.changeOrderId) coIds.add(m.changeOrderId);
  }
  for (const p of predecessors.data ?? []) coIds.add(p.changeOrderId);
  for (const s of successors.data ?? []) coIds.add(s.changeOrderId);

  // Reverse link: a released revision points at the CO that created it.
  for (const s of siblings.data ?? []) {
    if (s.changeOrderId) coIds.add(s.changeOrderId);
  }

  if (coIds.size === 0) return { data: [], error: null };

  let query = client
    .from("changeOrder")
    .select("id, changeOrderId, name, status, changeOrderTypeId, createdAt")
    .in("id", [...coIds])
    .eq("companyId", companyId);
  if (statuses && statuses.length > 0) query = query.in("status", statuses);
  query = query.order("createdAt", { ascending: false });

  const result = await query;
  if (result.error) return { data: [], error: result.error };
  return { data: result.data ?? [], error: null };
}

// Reverse of the Linked-NCR cross-link (4a): every change order that references
// a given non-conformance. Read-only, minimal columns; rendered on the Issue
// detail. Flat select (no embeds — TS2589 budget).
export async function getChangeOrdersForNonConformance(
  client: SupabaseClient<Database>,
  nonConformanceId: string,
  companyId: string
) {
  return client
    .from("changeOrder")
    .select("id, changeOrderId, name, status")
    .eq("nonConformanceId", nonConformanceId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
}

// Single-open-CO-per-part guard (V1 — no parallel change orders): the OTHER
// open change orders that already reference a part, excluding the current CO.
// Reuses the canonical G6 query at the open-status filter. A non-empty result
// means adding the part here would create a parallel open CO — the routes (and
// the staging service) reject it.
export async function findOtherOpenChangeOrdersForItem(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string; excludeChangeOrderId: string }
): Promise<ChangeOrderForItem[]> {
  const { data } = await findChangeOrdersForItem(client, {
    itemId: args.itemId,
    companyId: args.companyId,
    statuses: changeOrderOpenStatuses
  });
  return data.filter((co) => co.id !== args.excludeChangeOrderId);
}

// Loader data for the "Change Orders" history section + open-CO alert on an
// item detail page (part/tool/material) — the CO history for the item plus the
// type lookup used to label rows. One shared source so the detail routes don't
// each re-implement the pair of reads.
export async function getItemChangeOrderData(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const [changeOrders, changeOrderTypes] = await Promise.all([
    findChangeOrdersForItem(client, { itemId, companyId }),
    getChangeOrderTypesList(client, companyId)
  ]);
  return {
    changeOrders: changeOrders.data,
    changeOrderTypes: changeOrderTypes.data ?? []
  };
}
