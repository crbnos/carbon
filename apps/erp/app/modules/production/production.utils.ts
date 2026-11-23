// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
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
