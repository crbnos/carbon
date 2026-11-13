// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { fetchAllByIds } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { isSerialEntityIncompleteForOperation } from "~/services/operations.service";
import {
  isUnitInOperationScope,
  pickTravelerMaterial,
  type TravelerConsumption
} from "~/utils/traveler";

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
 * What is consumed into each unit now, per job material and component item:
 * the inputs of the `Consume` activities that output the unit, less the
 * outputs of the `Unconsume` activities that take it as input. A scrapped
 * component is no longer in the unit (its scrap reopened the requirement).
 * Both reads are paged (100 units per request, every page), so a long
 * history is never cut off at the row cap.
 */
export async function getUnitConsumption(
  client: ServiceRole,
  args: { companyId: string; unitIds: string[] }
): Promise<
  | { data: Map<string, TravelerConsumption[]>; error: null }
  | { data: null; error: unknown }
> {
  const result = new Map<string, TravelerConsumption[]>();
  const unitIds = [...new Set(args.unitIds)];
  if (unitIds.length === 0) return { data: result, error: null };

  const [consumed, returned] = await Promise.all([
    fetchAllByIds(unitIds, (batch) =>
      client
        .from("trackedActivity")
        .select(
          "id, attributes, trackedActivityOutput!inner(trackedEntityId), trackedActivityInput(trackedEntityId, quantity, trackedEntity(status, itemId))"
        )
        .eq("type", "Consume")
        .eq("companyId", args.companyId)
        .in("trackedActivityOutput.trackedEntityId", batch)
        .order("id")
    ),
    fetchAllByIds(unitIds, (batch) =>
      client
        .from("trackedActivity")
        .select(
          "id, attributes, trackedActivityInput!inner(trackedEntityId), trackedActivityOutput(trackedEntityId, quantity)"
        )
        .eq("type", "Unconsume")
        .eq("companyId", args.companyId)
        .in("trackedActivityInput.trackedEntityId", batch)
        .order("id")
    )
  ]);
  if (consumed.error || returned.error) {
    const error = consumed.error ?? returned.error;
    log.error("Could not read what is consumed into the units", {
      companyId: args.companyId,
      unitIds,
      error
    });
    return { data: null, error };
  }

  // Net per (unit, material, component), so a component given back and
  // fitted again counts once.
  const net = new Map<string, number>();
  const scrapped = new Set<string>();
  const itemOf = new Map<string, string | null>();
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
        itemOf.set(input.trackedEntityId, input.trackedEntity?.itemId ?? null);
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

  // Summed per (unit, material, item).
  const totals = new Map<string, number>();
  for (const [k, quantity] of net) {
    const [unitId, materialId, componentId] = JSON.parse(k) as [
      string,
      string,
      string
    ];
    if (scrapped.has(componentId) || quantity <= 0) continue;
    const t = JSON.stringify([
      unitId,
      materialId,
      itemOf.get(componentId) ?? null
    ]);
    totals.set(t, (totals.get(t) ?? 0) + quantity);
  }
  for (const [t, quantity] of totals) {
    const [unitId, materialId, itemId] = JSON.parse(t) as [
      string,
      string,
      string | null
    ];
    const entries = result.get(unitId) ?? [];
    entries.push({ materialId, itemId, quantity });
    result.set(unitId, entries);
  }
  return { data: result, error: null };
}

/**
 * The rework scope of each operation (`jobOperationTrackedEntity`): the units
 * an operation applies to, keyed by operation. An operation with no rows is
 * absent and applies to every unit (`isUnitInOperationScope`). One paged
 * read for any number of operations.
 */
export async function getOperationScopes(
  client: ServiceRole,
  args: { companyId: string; operationIds: string[] }
): Promise<
  | { data: Map<string, Set<string>>; error: null }
  | { data: null; error: unknown }
> {
  const scopes = new Map<string, Set<string>>();
  const operationIds = [...new Set(args.operationIds)];
  if (operationIds.length === 0) return { data: scopes, error: null };

  const rows = await fetchAllByIds(operationIds, (batch) =>
    client
      .from("jobOperationTrackedEntity")
      .select("jobOperationId, trackedEntityId")
      .in("jobOperationId", batch)
      .eq("companyId", args.companyId)
      .order("jobOperationId")
      .order("trackedEntityId")
  );
  if (rows.error) {
    log.error("Could not read the rework scope of the operations", {
      companyId: args.companyId,
      operationIds,
      error: rows.error
    });
    return { data: null, error: rows.error };
  }
  for (const row of rows.data) {
    const ids = scopes.get(row.jobOperationId) ?? new Set<string>();
    ids.add(row.trackedEntityId);
    scopes.set(row.jobOperationId, ids);
  }
  return { data: scopes, error: null };
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
    itemId: unit.itemId,
    unitConsumed: parentIsSerial
      ? (consumption.data?.get(args.parentTrackedEntityId) ?? [])
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
 * the unit's own make method that apply to the unit (a rework operation
 * applies only to the units sent into it). A failed read is an `error`, never
 * "not in production": the caller cannot tell, so it must not issue the unit.
 */
export async function isUnitInProduction(
  client: ServiceRole,
  args: {
    companyId: string;
    trackedEntityId: string | null | undefined;
    jobMakeMethodId: string | null | undefined;
  }
): Promise<{ data: boolean; error: null } | { data: null; error: unknown }> {
  if (!args.trackedEntityId || !args.jobMakeMethodId) {
    return { data: false, error: null };
  }
  const trackedEntityId = args.trackedEntityId;
  const [entity, operations] = await Promise.all([
    client
      .from("trackedEntity")
      .select("id, status, attributes")
      .eq("id", trackedEntityId)
      .eq("companyId", args.companyId)
      .maybeSingle(),
    client
      .from("jobOperation")
      .select("id, job!inner(status)")
      .eq("jobMakeMethodId", args.jobMakeMethodId)
      .eq("companyId", args.companyId)
      .not("status", "in", "(Done,Canceled)")
      .not("job.status", "in", "(Completed,Closed,Cancelled)")
  ]);
  if (entity.error || operations.error) {
    log.error("Could not check whether the unit is in production", {
      companyId: args.companyId,
      trackedEntityId,
      error: entity.error ?? operations.error
    });
    return { data: null, error: entity.error ?? operations.error };
  }
  if (!entity.data) return { data: false, error: null };
  const open = operations.data ?? [];
  if (open.length === 0) return { data: false, error: null };

  const scopes = await getOperationScopes(client, {
    companyId: args.companyId,
    operationIds: open.map((op) => op.id)
  });
  if (scopes.error || !scopes.data) {
    return { data: null, error: scopes.error };
  }
  const scopeData = scopes.data;
  const unit = entity.data;
  return {
    data: open.some((op) =>
      isSerialEntityIncompleteForOperation(
        {
          ...unit,
          inOperationScope: isUnitInOperationScope(
            scopeData,
            op.id,
            trackedEntityId
          )
        } as never,
        op.id
      )
    ),
    error: null
  };
}
