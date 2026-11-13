// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { isSerialEntityIncompleteForOperation } from "~/services/operations.service";
import { pickTravelerMaterial } from "~/utils/traveler";

type ServiceRole = Awaited<ReturnType<typeof getCarbonServiceRole>>;

type TrackedEntity = Database["public"]["Tables"]["trackedEntity"]["Row"];

export type TravelerTarget =
  Database["public"]["Functions"]["get_traveler_target"]["Returns"][number];

const log = getLogger("mes", "traveler");

const LOOKUP_FAILED = "Could not check this unit. Try again.";

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
 * is passed only through `.eq()`, never into a PostgREST `.or()` string. A
 * failed read is an `error`, never `notFound`: the operator must try again,
 * not throw the label away.
 */
export async function findTrackedEntityByCode(
  client: ServiceRole,
  args: { code: string; companyId: string }
): Promise<
  | { kind: "found"; entity: TrackedEntity }
  | { kind: "notFound" }
  | { kind: "ambiguous" }
  | { kind: "error" }
> {
  const byId = await client
    .from("trackedEntity")
    .select("*")
    .eq("id", args.code)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (byId.error) {
    log.error("Could not look up the scanned unit by id", {
      companyId: args.companyId,
      code: args.code,
      error: byId.error
    });
    return { kind: "error" };
  }
  if (byId.data) return { kind: "found", entity: byId.data };

  const byReadableId = await client
    .from("trackedEntity")
    .select("*")
    .eq("readableId", args.code)
    .eq("companyId", args.companyId)
    .limit(2);
  if (byReadableId.error) {
    log.error("Could not look up the scanned unit by readable id", {
      companyId: args.companyId,
      code: args.code,
      error: byReadableId.error
    });
    return { kind: "error" };
  }
  const rows = byReadableId.data ?? [];
  if (rows.length === 2) return { kind: "ambiguous" };
  if (rows.length === 1) return { kind: "found", entity: rows[0] };
  return { kind: "notFound" };
}

/**
 * What is consumed into each unit now, per job material: the inputs of the
 * `Consume` activities that output the unit, less the outputs of the
 * `Unconsume` activities that take it as input. A scrapped component is no
 * longer in the unit (its scrap reopened the requirement). Two reads, for
 * any number of units.
 */
export async function getUnitConsumption(
  client: ServiceRole,
  args: { companyId: string; unitIds: string[] }
): Promise<
  | { data: Map<string, Map<string, number>>; error: null }
  | { data: null; error: unknown }
> {
  const result = new Map<string, Map<string, number>>();
  if (args.unitIds.length === 0) return { data: result, error: null };

  const [consumed, returned] = await Promise.all([
    client
      .from("trackedActivity")
      .select(
        "attributes, trackedActivityOutput!inner(trackedEntityId), trackedActivityInput(trackedEntityId, quantity, trackedEntity(status))"
      )
      .eq("type", "Consume")
      .eq("companyId", args.companyId)
      .in("trackedActivityOutput.trackedEntityId", args.unitIds),
    client
      .from("trackedActivity")
      .select(
        "attributes, trackedActivityInput!inner(trackedEntityId), trackedActivityOutput(trackedEntityId, quantity)"
      )
      .eq("type", "Unconsume")
      .eq("companyId", args.companyId)
      .in("trackedActivityInput.trackedEntityId", args.unitIds)
  ]);
  if (consumed.error || returned.error) {
    const error = consumed.error ?? returned.error;
    log.error("Could not read what is consumed into the units", {
      companyId: args.companyId,
      unitIds: args.unitIds,
      error
    });
    return { data: null, error };
  }

  // Net per (unit, material, component), so a component given back and
  // fitted again counts once.
  const net = new Map<string, number>();
  const scrapped = new Set<string>();
  const key = (unitId: string, materialId: string, componentId: string) =>
    JSON.stringify([unitId, materialId, componentId]);
  const materialOf = (attributes: unknown) => {
    const value = (attributes as Record<string, unknown> | null)?.[
      "Job Material"
    ];
    return typeof value === "string" ? value : null;
  };

  for (const activity of consumed.data ?? []) {
    const materialId = materialOf(activity.attributes);
    if (!materialId) continue;
    for (const output of activity.trackedActivityOutput ?? []) {
      for (const input of activity.trackedActivityInput ?? []) {
        if (input.trackedEntity?.status === "Scrapped") {
          scrapped.add(input.trackedEntityId);
        }
        const k = key(
          output.trackedEntityId,
          materialId,
          input.trackedEntityId
        );
        net.set(k, (net.get(k) ?? 0) + Number(input.quantity ?? 0));
      }
    }
  }
  for (const activity of returned.data ?? []) {
    const materialId = materialOf(activity.attributes);
    if (!materialId) continue;
    for (const input of activity.trackedActivityInput ?? []) {
      for (const output of activity.trackedActivityOutput ?? []) {
        const k = key(
          input.trackedEntityId,
          materialId,
          output.trackedEntityId
        );
        if (!net.has(k)) continue;
        net.set(k, (net.get(k) ?? 0) - Number(output.quantity ?? 0));
      }
    }
  }

  for (const [k, quantity] of net) {
    const [unitId, materialId, componentId] = JSON.parse(k) as [
      string,
      string,
      string
    ];
    if (scrapped.has(componentId) || quantity <= 0) continue;
    const byMaterial = result.get(unitId) ?? new Map<string, number>();
    byMaterial.set(materialId, (byMaterial.get(materialId) ?? 0) + quantity);
    result.set(unitId, byMaterial);
  }
  return { data: result, error: null };
}

/**
 * Finds the job material a scanned unit issues into at this operation, and
 * refuses when none still needs it (`pickTravelerMaterial`). A serial parent
 * counts what is consumed into that unit; any other parent counts what the
 * job has issued. Prefers the material on this operation, then an
 * unassigned one on the same make method. Batch-tracked materials refuse:
 * batch lots issue from the Issue dialog. This is the gate: the scan UI and
 * the traveler chooser only mirror it.
 */
export async function resolveTravelerMaterial(
  client: ServiceRole,
  args: {
    companyId: string;
    jobOperationId: string;
    trackedEntityId: string;
    parentTrackedEntityId: string;
  }
): Promise<{ materialId: string; quantity: number } | { refusal: string }> {
  const [unitRead, operationRead] = await Promise.all([
    client
      .from("trackedEntity")
      .select("id, status, quantity, itemId")
      .eq("id", args.trackedEntityId)
      .eq("companyId", args.companyId)
      .maybeSingle(),
    client
      .from("jobOperation")
      .select("jobMakeMethodId, jobMakeMethod(requiresSerialTracking)")
      .eq("id", args.jobOperationId)
      .eq("companyId", args.companyId)
      .maybeSingle()
  ]);
  if (unitRead.error || operationRead.error) {
    log.error("Could not read the scanned unit or the operation", {
      companyId: args.companyId,
      jobOperationId: args.jobOperationId,
      trackedEntityId: args.trackedEntityId,
      error: unitRead.error ?? operationRead.error
    });
    return { refusal: LOOKUP_FAILED };
  }
  const unit = unitRead.data;
  if (!unit) {
    return { refusal: "This label does not belong to a unit in this company" };
  }
  if (unit.status !== "Available") {
    return { refusal: `This unit is ${unit.status} and cannot be issued` };
  }

  const operation = operationRead.data;
  const parentIsSerial = !!operation?.jobMakeMethod?.requiresSerialTracking;

  const [materialsRead, consumption, itemRead] = await Promise.all([
    operation?.jobMakeMethodId && unit.itemId
      ? client
          .from("jobMaterial")
          .select(
            "id, jobOperationId, quantity, estimatedQuantity, quantityIssued, requiresBatchTracking"
          )
          .eq("jobMakeMethodId", operation.jobMakeMethodId)
          .eq("itemId", unit.itemId)
          .eq("companyId", args.companyId)
      : Promise.resolve({ data: [], error: null }),
    parentIsSerial
      ? getUnitConsumption(client, {
          companyId: args.companyId,
          unitIds: [args.parentTrackedEntityId]
        })
      : Promise.resolve({ data: null, error: null }),
    unit.itemId
      ? client
          .from("item")
          .select("readableIdWithRevision")
          .eq("id", unit.itemId)
          .eq("companyId", args.companyId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  if (materialsRead.error || consumption.error) {
    log.error("Could not read the job materials for a traveler scan", {
      companyId: args.companyId,
      jobOperationId: args.jobOperationId,
      parentTrackedEntityId: args.parentTrackedEntityId,
      error: materialsRead.error ?? consumption.error
    });
    return { refusal: LOOKUP_FAILED };
  }
  if (itemRead.error) {
    log.error("Could not read the scanned unit's item", {
      companyId: args.companyId,
      itemId: unit.itemId,
      error: itemRead.error
    });
  }
  const readableId = itemRead.data?.readableIdWithRevision ?? unit.itemId ?? "";

  const picked = pickTravelerMaterial({
    materials: materialsRead.data ?? [],
    jobOperationId: args.jobOperationId,
    unitConsumed: parentIsSerial
      ? (consumption.data?.get(args.parentTrackedEntityId) ??
        new Map<string, number>())
      : null
  });
  if (picked.kind === "notUsed") {
    return { refusal: `This job does not use ${readableId}` };
  }
  if (picked.kind === "full") {
    return {
      refusal: parentIsSerial
        ? `This unit already has its ${readableId}`
        : `This job already has all its ${readableId}`
    };
  }
  if (picked.material.requiresBatchTracking) {
    return { refusal: "Issue batch lots from the Issue dialog" };
  }

  return { materialId: picked.material.id, quantity: unit.quantity };
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
