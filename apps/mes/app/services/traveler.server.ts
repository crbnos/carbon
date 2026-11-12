// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { isSerialEntityIncompleteForOperation } from "~/services/operations.service";

type ServiceRole = Awaited<ReturnType<typeof getCarbonServiceRole>>;

type TrackedEntity = Database["public"]["Tables"]["trackedEntity"]["Row"];

export type TravelerTarget =
  Database["public"]["Functions"]["get_traveler_target"]["Returns"][number];

const log = getLogger("mes", "traveler");

/**
 * Resolves the job a scanned unit travels on: the unit's own job, or the job
 * of the nearest ancestor it was consumed into (`get_traveler_target` walks
 * the genealogy).
 */
export async function getTravelerTarget(
  client: ServiceRole,
  args: { trackedEntityId: string; companyId: string }
): Promise<TravelerTarget | null> {
  const { data, error } = await client.rpc("get_traveler_target", {
    p_tracked_entity_id: args.trackedEntityId,
    p_company_id: args.companyId
  });
  if (error) {
    log.error("get_traveler_target failed", {
      trackedEntityId: args.trackedEntityId,
      error: error.message
    });
    return null;
  }
  return data?.[0] ?? null;
}

/**
 * Finds the unit a scanned or typed code names: by id first, then by
 * `readableId`. Two units with the same `readableId` are ambiguous. The code
 * is passed only through `.eq()`, never into a PostgREST `.or()` string.
 */
export async function findTrackedEntityByCode(
  client: ServiceRole,
  args: { code: string; companyId: string }
): Promise<
  | { kind: "found"; entity: TrackedEntity }
  | { kind: "notFound" }
  | { kind: "ambiguous" }
> {
  const byId = await client
    .from("trackedEntity")
    .select("*")
    .eq("id", args.code)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (byId.data) return { kind: "found", entity: byId.data };

  const byReadableId = await client
    .from("trackedEntity")
    .select("*")
    .eq("readableId", args.code)
    .eq("companyId", args.companyId)
    .limit(2);
  const rows = byReadableId.data ?? [];
  if (rows.length === 2) return { kind: "ambiguous" };
  if (rows.length === 1) return { kind: "found", entity: rows[0] };
  return { kind: "notFound" };
}

/**
 * Finds the job material a scanned unit issues into at this operation.
 * Prefers the material on this operation, then an unassigned one on the same
 * make method. Batch-tracked materials refuse: batch lots issue from the
 * Issue dialog.
 */
export async function resolveTravelerMaterial(
  client: ServiceRole,
  args: { companyId: string; jobOperationId: string; trackedEntityId: string }
): Promise<{ materialId: string; quantity: number } | { refusal: string }> {
  const { data: unit } = await client
    .from("trackedEntity")
    .select("id, status, quantity, itemId")
    .eq("id", args.trackedEntityId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (!unit) {
    return { refusal: "This label does not belong to a unit in this company" };
  }
  if (unit.status !== "Available") {
    return { refusal: `This unit is ${unit.status} and cannot be issued` };
  }

  const { data: operation } = await client
    .from("jobOperation")
    .select("jobMakeMethodId")
    .eq("id", args.jobOperationId)
    .eq("companyId", args.companyId)
    .maybeSingle();

  const { data: materials } =
    operation?.jobMakeMethodId && unit.itemId
      ? await client
          .from("jobMaterial")
          .select("id, jobOperationId, requiresBatchTracking")
          .eq("jobMakeMethodId", operation.jobMakeMethodId)
          .eq("itemId", unit.itemId)
          .eq("companyId", args.companyId)
      : { data: null };

  const material =
    materials?.find((m) => m.jobOperationId === args.jobOperationId) ??
    materials?.find((m) => m.jobOperationId === null);

  if (!material) {
    const { data: item } = unit.itemId
      ? await client
          .from("item")
          .select("readableIdWithRevision")
          .eq("id", unit.itemId)
          .eq("companyId", args.companyId)
          .maybeSingle()
      : { data: null };
    const readableId = item?.readableIdWithRevision ?? unit.itemId ?? "";
    return { refusal: `This job does not use ${readableId}` };
  }

  if (material.requiresBatchTracking) {
    return { refusal: "Issue batch lots from the Issue dialog" };
  }

  return { materialId: material.id, quantity: unit.quantity };
}

/**
 * Whether a unit is still being built by its own job. A serial unit turns
 * Available after ANY completed operation, so status alone cannot tell a unit
 * between stations from a finished one: this checks the open operations of
 * the unit's own make method.
 */
export async function isUnitInProduction(
  client: ServiceRole,
  args: {
    companyId: string;
    trackedEntityId: string | null | undefined;
    jobMakeMethodId: string | null | undefined;
  }
): Promise<boolean> {
  if (!args.trackedEntityId || !args.jobMakeMethodId) return false;
  const [entity, operations] = await Promise.all([
    client
      .from("trackedEntity")
      .select("id, status, attributes")
      .eq("id", args.trackedEntityId)
      .eq("companyId", args.companyId)
      .maybeSingle(),
    client
      .from("jobOperation")
      .select("id")
      .eq("jobMakeMethodId", args.jobMakeMethodId)
      .eq("companyId", args.companyId)
      .not("status", "in", "(Done,Canceled)")
  ]);
  if (entity.error || operations.error) {
    log.error("Could not check whether the unit is in production", {
      companyId: args.companyId,
      trackedEntityId: args.trackedEntityId,
      error: entity.error ?? operations.error
    });
    return false;
  }
  if (!entity.data) return false;
  return (operations.data ?? []).some((op) =>
    isSerialEntityIncompleteForOperation(entity.data as never, op.id)
  );
}
