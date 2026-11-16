// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { fetchAll } from "@carbon/database/fetch-all";
import { resolvePlanningTimeFenceDays } from "@carbon/utils";
import type { AssemblyStep } from "@carbon/viewer";
import { isPlanFlagged } from "@carbon/viewer/steps";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cameraSchema,
  fastenerSchema,
  motionSchema,
  orientationSchema
} from "./production.models";
import type { AssemblyInstructionStepRow } from "./types";

export async function getJobMethodTree(
  client: SupabaseClient<Database>,
  jobId: string
) {
  const items = await getJobMethodTreeArray(client, jobId);
  if (items.error) return items;

  const tree = getJobMethodTreeArrayToTree(items.data);

  return {
    data: tree,
    error: null
  };
}

export async function getJobMethodTreeArray(
  client: SupabaseClient<Database>,
  jobId: string
) {
  return client.rpc("get_job_method", {
    jid: jobId
  });
}

function getJobMethodTreeArrayToTree(items: JobMethod[]): JobMethodTreeItem[] {
  // function traverseAndRenameIds(node: JobMethodTreeItem) {
  //   const clone = structuredClone(node);
  //   clone.id = `node-${Math.random().toString(16).slice(2)}`;
  //   clone.children = clone.children.map((n) => traverseAndRenameIds(n));
  //   return clone;
  // }

  const rootItems: JobMethodTreeItem[] = [];
  const lookup: { [id: string]: JobMethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      // @ts-expect-error
      lookup[itemId] = { id: itemId, children: [] };
    }

    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-expect-error
        lookup[parentId] = { id: parentId, children: [] };
      }

      // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
      lookup[parentId]["children"].push(treeItem);
    }
  }
  return rootItems;
  // return rootItems.map((item) => traverseAndRenameIds(item));
}

export type JobMethod = NonNullable<
  Awaited<ReturnType<typeof getJobMethodTreeArray>>["data"]
>[number];

export type JobMethodTreeItem = {
  id: string;
  data: JobMethod;
  children: JobMethodTreeItem[];
};

export async function getProductionEventsPage(
  client: SupabaseClient<Database>,
  jobOperationId: string,
  companyId: string,
  sortDescending: boolean = false,
  page: number = 1
) {
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  let query = client
    .from("productionEvent")
    .select("*", { count: "exact" })
    .eq("jobOperationId", jobOperationId)
    .eq("companyId", companyId)
    .order("startTime", { ascending: !sortDescending })
    .range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;

  if (error) {
    return { error };
  }

  return {
    data,
    count,
    page,
    pageSize,
    hasMore: count !== null && offset + pageSize < count
  };
}

/**
 * Maps a DB step row to the viewer's step shape. JSONB columns are validated
 * defensively — `path` motions with invalid keyframes throw inside the viewer,
 * so anything that fails the schema falls back to a safe default.
 */
export function toViewerStep(step: AssemblyInstructionStepRow): AssemblyStep {
  const motion = motionSchema.safeParse(step.motion);
  const camera = cameraSchema.safeParse(step.camera);
  const orientation = orientationSchema.safeParse(step.orientation);
  const fastener = fastenerSchema.safeParse(step.fastener);

  return {
    id: step.id,
    title: step.title,
    instructionText: step.instructionText,
    componentNodeIds: step.componentNodeIds ?? [],
    hiddenComponentNodeIds: step.hiddenComponentNodeIds ?? [],
    isSubAssembly: step.isSubAssembly,
    parentStepId: step.parentStepId ?? null,
    usedInStepId: step.usedInStepId ?? null,
    motion: motion.success ? motion.data : { type: "none" },
    camera: camera.success ? camera.data : null,
    orientation: orientation.success ? orientation.data : null,
    fastener: fastener.success ? fastener.data : null,
    durationSeconds: step.durationSeconds,
    flagged: isPlanFlagged(step.warnings, step.motion) ? true : undefined
  };
}

// ── Planned orders in the planning drawers ─────────────────────────────────
// Read in the browser with the user's client, as the drawers read their open
// jobs and PO lines: the `plannedOrder` SELECT policy is production_view or
// purchasing_view, the two pages that open these drawers.

const DRAWER_PLANNED_ORDER_COLUMNS =
  "id, itemId, periodId, splitIndex, status, orderType, quantity, scrapQuantity, quantityTrace, dueDate, releaseDate, firmedAt" as const;

/** The Planned and Firm planned orders of a location and type, in the
 *  common segment: a Converted row is its job or PO line now. */
function plannedOrdersQuery(
  client: SupabaseClient<Database>,
  args: { companyId: string; locationId: string; orderType: "Make" | "Buy" }
) {
  return client
    .from("plannedOrder")
    .select(DRAWER_PLANNED_ORDER_COLUMNS)
    .eq("companyId", args.companyId)
    .eq("locationId", args.locationId)
    .eq("orderType", args.orderType)
    .eq("planningSegmentId", "")
    .in("status", ["Planned", "Firm"]);
}

export type DrawerPlannedOrder = NonNullable<
  Awaited<ReturnType<typeof plannedOrdersQuery>>["data"]
>[number];

type PlannedOrderRead =
  | { data: DrawerPlannedOrder[]; error: null }
  | { data: null; error: Error };

/**
 * The Planned and Firm planned orders of one item at one location, by due
 * date: the rows of the drawer's Planned Orders grid. Planned orders exist
 * only in the common segment. A Converted row is its job or PO line now, which
 * the drawer lists as an open order. Paged, so production's `max_rows` (1000)
 * never cuts an item with many short orders.
 */
export async function getDrawerPlannedOrders(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    itemId: string;
    locationId: string;
    orderType: "Make" | "Buy";
  }
): Promise<PlannedOrderRead> {
  const read = await fetchAll<DrawerPlannedOrder>(() =>
    plannedOrdersQuery(client, args)
      .eq("itemId", args.itemId)
      .order("dueDate", { ascending: true })
      .order("id", { ascending: true })
  );
  if (read.error) return { data: null, error: new Error(read.error.message) };
  return { data: read.data ?? [], error: null };
}

/** Item ids per request: the ids travel in the URL (`in.(…)`). */
const PLANNED_ORDER_ITEM_CHUNK = 100;

/**
 * The Planned and Firm planned orders of many items at one location, for a
 * bulk Make / Order on the planning grids: each suggested order of a row then
 * names the planned order it stands for. 100 items per request, so a large
 * selection never builds a URL the gateway refuses, and each request paged
 * by id, so production's `max_rows` (1000) never cuts it short.
 */
export async function getRowPlannedOrders(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    locationId: string;
    orderType: "Make" | "Buy";
    itemIds: string[];
  }
): Promise<PlannedOrderRead> {
  const itemIds = [...new Set(args.itemIds)];
  const chunks: string[][] = [];
  for (let i = 0; i < itemIds.length; i += PLANNED_ORDER_ITEM_CHUNK) {
    chunks.push(itemIds.slice(i, i + PLANNED_ORDER_ITEM_CHUNK));
  }
  const reads = await Promise.all(
    chunks.map((ids) =>
      fetchAll<DrawerPlannedOrder>(() =>
        plannedOrdersQuery(client, args)
          .in("itemId", ids)
          .order("id", { ascending: true })
      )
    )
  );
  const failed = reads.find((read) => read.error)?.error;
  if (failed) return { data: null, error: new Error(failed.message) };
  return { data: reads.flatMap((read) => read.data ?? []), error: null };
}

/**
 * The item's planning time fence at a location, in calendar days, as MRP
 * resolves it: the item's own value, else the location's, else 0 (no fence).
 */
export async function getPlanningTimeFenceDays(
  client: SupabaseClient<Database>,
  args: { companyId: string; itemId: string; locationId: string }
): Promise<{ data: number; error: null } | { data: null; error: Error }> {
  const [itemPlanning, location] = await Promise.all([
    client
      .from("itemPlanning")
      .select("planningTimeFenceDays")
      .eq("companyId", args.companyId)
      .eq("itemId", args.itemId)
      .eq("locationId", args.locationId)
      .maybeSingle(),
    client
      .from("location")
      .select("planningTimeFenceDays")
      .eq("companyId", args.companyId)
      .eq("id", args.locationId)
      .maybeSingle()
  ]);
  const failed = itemPlanning.error ?? location.error;
  if (failed) return { data: null, error: new Error(failed.message) };
  return {
    data: resolvePlanningTimeFenceDays(
      itemPlanning.data?.planningTimeFenceDays,
      location.data?.planningTimeFenceDays
    ),
    error: null
  };
}
