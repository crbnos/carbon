// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  fetchAllByIds,
  fetchAllRecords,
  getLocationTimeZone
} from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { datetime, resolveTrackedEntityBins } from "@carbon/utils";
import { erpPosting } from "~/services/erp";
import {
  getIssueLotStock,
  getJobOperationIssueScope
} from "~/services/inventory.service";
import {
  abilityBlockRefusal,
  getActiveJobOperationsByLocation,
  getMyPeopleAssignment,
  isSerialEntityIncompleteForOperation
} from "~/services/operations.service";
import { makeDurations } from "~/utils/durations";
import {
  batchScanQuantity,
  isUnitInOperationScope,
  pickTravelerClaims,
  pickTravelerMaterial,
  pickTravelerOperation,
  type TravelerClaim,
  type TravelerConsumption,
  travelerIssueCandidates
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
      error
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
      .select("id, status, quantity, itemId, sourceDocument, sourceDocumentId")
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
  const scanned = unitRead.data;
  if (!scanned) {
    return { refusal: "This label does not belong to a unit in this company" };
  }
  // A received lot names its item as its source document.
  const unit = {
    ...scanned,
    itemId:
      scanned.itemId ??
      (scanned.sourceDocument === "Item" ? scanned.sourceDocumentId : null)
  };
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
  // One scan of a lot's label takes what is still needed, up to what the
  // lot holds where the job can draw it: the same stock the Issue dialog
  // lists, so a quarantined lot or one at another location is refused.
  if (picked.material.requiresBatchTracking && unit.itemId) {
    const scope = await getJobOperationIssueScope(client, args);
    const stock = scope.locationId
      ? await getIssueLotStock(client, {
          companyId: args.companyId,
          locationId: scope.locationId,
          itemIds: [unit.itemId],
          stripes: scope.stripes,
          trackedEntityId: unit.id
        })
      : { data: [], error: null };
    if (stock.error) {
      log.error("Could not read a scanned lot's stock", {
        companyId: args.companyId,
        trackedEntityId: unit.id,
        error: stock.error
      });
      return { refusal: LOOKUP_FAILED };
    }
    const available = (stock.data ?? []).reduce(
      (sum, row) => sum + (row.availableQuantity ?? 0),
      0
    );
    const quantity = batchScanQuantity({
      needed: picked.needed,
      available: Math.min(available, unit.quantity)
    });
    if (quantity <= 0) {
      return {
        refusal: `This lot of ${readableId} is not in stock this job can use at its location`
      };
    }
    return { materialId: picked.material.id, quantity };
  }

  return { materialId: picked.material.id, quantity: unit.quantity };
}

export type ActiveOperation = ReturnType<
  typeof makeDurations<
    NonNullable<
      Awaited<ReturnType<typeof getActiveJobOperationsByLocation>>["data"]
    >[number]
  >
>;

export type TravelerUnit = {
  id: string;
  readableId: string;
  status: TrackedEntity["status"];
  itemReadableId: string | null;
  itemName: string | null;
};

/** Where a scan can put a free unit, with what the operator sees for it. */
export type TravelerClaimOption = TravelerClaim & {
  operation: ActiveOperation;
  parentReadableId: string;
};

/** The operation page an operator scanned on: claims stay inside it. */
export type TravelerScanAt = {
  operationId: string;
  /** The unit on screen; it takes the scan first when it still needs it. */
  trackedEntityId?: string;
};

export type TravelerResolution =
  | { kind: "notFound" }
  | { kind: "status"; unit: TravelerUnit }
  | {
      kind: "open";
      unit: TravelerUnit;
      operationId: string;
      trackedEntityId: string;
    }
  | {
      kind: "chooseOperation";
      unit: TravelerUnit;
      operations: ActiveOperation[];
    }
  /** `auto`: the first option is safe to take without asking (see below). */
  | {
      kind: "claim";
      unit: TravelerUnit;
      options: TravelerClaimOption[];
      auto: boolean;
    }
  | { kind: "refuse"; unit: TravelerUnit; message: string }
  | { kind: "info"; unit: TravelerUnit; storageUnitName: string | null };

const MAX_CLAIM_OPTIONS = 10;

/**
 * What a scan of `trackedEntityId` means for this operator, without writing
 * anything. The genealogy walk finds the unit the label now travels with:
 *
 * - A unit still being built opens its operation (the operator's station,
 *   else the next in routing order; parallel ones ask).
 * - A free unit (a kit or a finished sub-assembly in stock) is claimed into
 *   the next unit that still needs its item. On an operation page only that
 *   operation is offered. Elsewhere the claim is `auto` when the best option
 *   is at the operator's station, or is the only one at the location;
 *   otherwise the operator chooses.
 */
export async function resolveTravelerScan(
  client: ServiceRole,
  args: {
    companyId: string;
    locationId: string | null;
    employeeId: string | null;
    trackedEntityId: string;
    at?: TravelerScanAt;
  }
): Promise<TravelerResolution> {
  const { companyId, locationId, employeeId, at } = args;

  const [target, workCenterId, active] = await Promise.all([
    getTravelerTarget(client, {
      trackedEntityId: args.trackedEntityId,
      companyId
    }),
    getOperatorWorkCenter(client, { companyId, locationId, employeeId }),
    locationId
      ? getActiveJobOperationsByLocation(client, locationId, [])
      : Promise.resolve(null)
  ]);
  if (!target) return { kind: "notFound" };

  const { data: row } = await client
    .from("trackedEntity")
    .select(
      "id, readableId, status, itemId, quantity, attributes, item(readableIdWithRevision, name)"
    )
    .eq("id", target.trackedEntityId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!row) return { kind: "notFound" };
  const { item, ...entity } = row;
  const unit: TravelerUnit = {
    id: entity.id,
    readableId: entity.readableId ?? entity.id,
    status: entity.status,
    itemReadableId: item?.readableIdWithRevision ?? null,
    itemName: item?.name ?? null
  };
  if (entity.status !== "Reserved" && entity.status !== "Available") {
    return { kind: "status", unit };
  }

  const rows = (active?.data ?? []).map(makeDurations);
  // A failed scope read treats every operation as applying to every unit,
  // so the unit reads as in production rather than free to claim.
  const scopes =
    (
      await getOperationScopes(client, {
        companyId,
        operationIds: rows.map((r) => r.id)
      })
    ).data ?? new Map<string, Set<string>>();
  const appliesTo = (operationId: string, unitId: string) =>
    isUnitInOperationScope(scopes, operationId, unitId);
  const isOpenFor = (operationId: string) =>
    isSerialEntityIncompleteForOperation(
      { ...entity, inOperationScope: appliesTo(operationId, entity.id) },
      operationId
    );

  // A unit of the job on screen opens here, whatever its status.
  const onScreen = at && rows.find((r) => r.id === at.operationId);
  if (onScreen && onScreen.jobMakeMethodId === target.jobMakeMethodId) {
    return {
      kind: "open",
      unit,
      operationId: onScreen.id,
      trackedEntityId: entity.id
    };
  }

  // A serial unit turns Available after ANY completed operation, so a unit
  // whose own make method still has open operations for it is in production.
  const own = target.jobMakeMethodId
    ? rows.filter(
        (r) => r.jobMakeMethodId === target.jobMakeMethodId && isOpenFor(r.id)
      )
    : [];
  if (entity.status === "Reserved" || own.length > 0) {
    const picked = pickTravelerOperation({ operations: own, workCenterId });
    if (picked.kind === "open") {
      return {
        kind: "open",
        unit,
        operationId: picked.operationId,
        trackedEntityId: entity.id
      };
    }
    if (picked.kind === "choose") {
      const ids = new Set(picked.operationIds);
      return {
        kind: "chooseOperation",
        unit,
        operations: own.filter((r) => ids.has(r.id))
      };
    }
    return { kind: "info", unit, storageUnitName: null };
  }

  // A free unit. On an operation page only that operation may take it, so a
  // wrong scan is refused instead of landing in another job.
  const scope = at ? rows.filter((r) => r.id === at.operationId) : rows;
  const options = await getClaimOptions(client, {
    companyId,
    operations: scope,
    workCenterId,
    itemId: entity.itemId,
    appliesTo,
    preferredUnitId: at?.trackedEntityId ?? null
  });

  if (options.length === 0) {
    if (at) {
      return {
        kind: "refuse",
        unit,
        message: unit.itemReadableId
          ? `Nothing open here still needs ${unit.itemReadableId}`
          : "Nothing open here needs this unit"
      };
    }
    return {
      kind: "info",
      unit,
      storageUnitName: await getUnitStorageUnitName(client, {
        companyId,
        trackedEntityId: entity.id
      })
    };
  }

  const best = options[0]!.operation;
  const auto =
    !!at ||
    options.length === 1 ||
    (workCenterId !== null && best.workCenterId === workCenterId);
  return { kind: "claim", unit, options, auto };
}

/**
 * Resolves a scan and, when the result is a claim that is safe to take,
 * issues the scanned unit into the claimed unit. The result is decided from
 * state alone, so a retried request is safe: a unit claimed by the first
 * attempt is Consumed, and the second attempt opens its work instead. When
 * another scan takes the same unit first, the posting refuses (it re-checks
 * the requirement under a lock) and the scan resolves once more.
 */
export async function scanTraveler(
  client: ServiceRole,
  args: {
    companyId: string;
    userId: string;
    locationId: string | null;
    employeeId: string | null;
    trackedEntityId: string;
    at?: TravelerScanAt & {
      jobOperationStepId?: string;
      unitNumber?: number;
    };
  }
): Promise<
  | {
      resolution: TravelerResolution;
      claimed: TravelerClaimOption | null;
      error: null;
    }
  | { resolution: null; claimed: null; error: string }
> {
  let lastError = "Could not issue this unit. Try again.";
  for (let attempt = 0; attempt < 2; attempt++) {
    const resolution = await resolveTravelerScan(client, args);
    if (resolution.kind !== "claim" || !resolution.auto) {
      return { resolution, claimed: null, error: null };
    }
    const claim = resolution.options[0]!;
    // Step attribution belongs to the unit on screen only.
    const sameUnit = args.at?.trackedEntityId === claim.parentTrackedEntityId;
    const issued = await issueTravelerUnit(client, {
      companyId: args.companyId,
      userId: args.userId,
      // The unit the label travels with now: a kit's chamber, not the kit.
      trackedEntityId: resolution.unit.id,
      claim,
      jobOperationStepId: sameUnit ? args.at?.jobOperationStepId : undefined,
      unitNumber: sameUnit ? args.at?.unitNumber : undefined
    });
    if (!issued.error) return { resolution, claimed: claim, error: null };
    lastError = issued.error;
    if (!issued.retryable) break;
  }
  return { resolution: null, claimed: null, error: lastError };
}

/** Issues a scanned unit into the unit a claim names, through the ERP. */
async function issueTravelerUnit(
  client: ServiceRole,
  args: {
    companyId: string;
    userId: string;
    trackedEntityId: string;
    claim: TravelerClaim;
    jobOperationStepId?: string;
    unitNumber?: number;
  }
): Promise<{ error: null } | { error: string; retryable: boolean }> {
  const { companyId, userId, claim } = args;
  const refusal = await abilityBlockRefusal(client, {
    operationId: claim.operationId,
    employeeId: userId,
    companyId
  });
  if (refusal) return { error: refusal, retryable: false };

  // The gate every traveler issue passes: the right item, still needed, and
  // the quantity (a batch lot takes what the material still needs).
  const resolved = await resolveTravelerMaterial(client, {
    companyId,
    jobOperationId: claim.operationId,
    trackedEntityId: args.trackedEntityId,
    parentTrackedEntityId: claim.parentTrackedEntityId
  });
  if ("refusal" in resolved) {
    return { error: resolved.refusal, retryable: true };
  }

  const issued = await erpPosting(
    "issue",
    { companyId, userId },
    {
      type: "trackedEntitiesToOperation",
      materialId: resolved.materialId,
      jobOperationId: claim.operationId,
      parentTrackedEntityId: claim.parentTrackedEntityId,
      children: [
        { trackedEntityId: args.trackedEntityId, quantity: resolved.quantity }
      ],
      jobOperationStepId: args.jobOperationStepId,
      unitNumber: args.unitNumber,
      // The posting re-checks the requirement under a lock.
      travelerScan: true
    }
  );
  if (issued.error) {
    log.error("Could not issue a scanned unit", {
      companyId,
      trackedEntityId: args.trackedEntityId,
      claim,
      error: issued.error
    });
    return {
      error: issued.error.message || "Could not issue this unit",
      retryable: true
    };
  }
  return { error: null };
}

/** The operator's station today, from the people assignment. */
async function getOperatorWorkCenter(
  client: ServiceRole,
  args: {
    companyId: string;
    locationId: string | null;
    employeeId: string | null;
  }
): Promise<string | null> {
  if (!args.locationId || !args.employeeId) return null;
  const today = datetime.today(
    await getLocationTimeZone(client, args.locationId, args.companyId)
  );
  const assignment = await getMyPeopleAssignment(client, {
    companyId: args.companyId,
    employeeId: args.employeeId,
    date: today.toString()
  });
  return assignment.data?.[0]?.workCenterId ?? null;
}

/**
 * Every place a free unit of `itemId` can go among `operations`, best first:
 * the operator's station, then the earliest due date, then routing order
 * (`travelerIssueCandidates`), each with the unit it would join
 * (`pickTravelerClaims`). Reads only live units of the candidate make
 * methods, and what is consumed into the serial ones, in one batch each.
 */
async function getClaimOptions(
  client: ServiceRole,
  args: {
    companyId: string;
    operations: ActiveOperation[];
    workCenterId: string | null;
    itemId: string | null;
    appliesTo: (operationId: string, unitId: string) => boolean;
    preferredUnitId: string | null;
  }
): Promise<TravelerClaimOption[]> {
  const { companyId, operations, itemId } = args;
  const makeMethodIds = [...new Set(operations.map((r) => r.jobMakeMethodId))];
  if (!itemId || makeMethodIds.length === 0) return [];

  const [materialsRead, makeMethodsRead] = await Promise.all([
    client
      .from("jobMaterial")
      .select(
        "id, jobMakeMethodId, jobOperationId, quantity, estimatedQuantity, quantityIssued"
      )
      .eq("itemId", itemId)
      .in("jobMakeMethodId", makeMethodIds)
      .eq("companyId", companyId),
    client
      .from("jobMakeMethod")
      .select("id, requiresSerialTracking")
      .in("id", makeMethodIds)
      .eq("companyId", companyId)
  ]);
  if (materialsRead.error || makeMethodsRead.error) {
    log.error("Could not read the job materials for a traveler", {
      companyId,
      itemId,
      error: materialsRead.error ?? makeMethodsRead.error
    });
    return [];
  }
  const materials = materialsRead.data.flatMap((m) =>
    m.jobMakeMethodId ? [{ ...m, jobMakeMethodId: m.jobMakeMethodId }] : []
  );
  const serialMakeMethodIds = new Set(
    makeMethodsRead.data
      .filter((m) => m.requiresSerialTracking)
      .map((m) => m.id)
  );

  const candidateIds = travelerIssueCandidates({
    operations,
    materials,
    workCenterId: args.workCenterId,
    perUnitMakeMethodIds: serialMakeMethodIds
  });
  if (candidateIds.length === 0) return [];
  const byId = new Map(operations.map((r) => [r.id, r]));
  const candidates = candidateIds.map((id) => byId.get(id)!);
  const candidateMakeMethodIds = [
    ...new Set(candidates.map((r) => r.jobMakeMethodId))
  ];

  // Live units only: a consumed or scrapped unit is never a parent.
  const units = await fetchAllRecords(() =>
    client
      .from("trackedEntity")
      .select("id, readableId, status, attributes")
      .in("attributes->>Job Make Method", candidateMakeMethodIds)
      .eq("companyId", companyId)
      .not("status", "in", "(Consumed,Scrapped)")
      .order("createdAt", { ascending: true })
      .order("readableId", { ascending: true })
      .order("id", { ascending: true })
  );
  if (units.error) {
    log.error("Could not read the units of the candidate operations", {
      companyId,
      error: units.error
    });
    return [];
  }
  const unitById = new Map(units.data.map((u) => [u.id, u]));
  const unitIds = new Map<string, string[]>();
  for (const u of units.data) {
    const makeMethodId = (u.attributes as Record<string, unknown> | null)?.[
      "Job Make Method"
    ];
    if (typeof makeMethodId !== "string") continue;
    unitIds.set(makeMethodId, [...(unitIds.get(makeMethodId) ?? []), u.id]);
  }
  const isOpenAt = (unitId: string, operationId: string) => {
    const u = unitById.get(unitId);
    return (
      !!u &&
      isSerialEntityIncompleteForOperation(
        {
          ...u,
          inOperationScope: args.appliesTo(operationId, unitId)
        } as never,
        operationId
      )
    );
  };

  const serialUnitIds = candidates
    .filter((r) => serialMakeMethodIds.has(r.jobMakeMethodId))
    .flatMap((r) =>
      (unitIds.get(r.jobMakeMethodId) ?? []).filter((id) => isOpenAt(id, r.id))
    );
  const consumption = await getUnitConsumption(client, {
    companyId,
    unitIds: serialUnitIds
  });
  if (!consumption.data) return [];

  return pickTravelerClaims({
    operations: candidates,
    unitIds,
    isOpenAt,
    serialMakeMethodIds,
    materials,
    itemId,
    consumed: consumption.data,
    preferredUnitId: args.preferredUnitId
  })
    .slice(0, MAX_CLAIM_OPTIONS)
    .map((claim) => ({
      ...claim,
      operation: byId.get(claim.operationId)!,
      parentReadableId:
        unitById.get(claim.parentTrackedEntityId)?.readableId ??
        claim.parentTrackedEntityId
    }));
}

/** The storage unit a unit sits in, for the "nothing needs it" card. */
async function getUnitStorageUnitName(
  client: ServiceRole,
  args: { companyId: string; trackedEntityId: string }
): Promise<string | null> {
  const { data: ledgers } = await client
    .from("itemLedger")
    .select("trackedEntityId, storageUnitId, quantity")
    .eq("trackedEntityId", args.trackedEntityId)
    .eq("companyId", args.companyId);
  const storageUnitId =
    resolveTrackedEntityBins(ledgers ?? []).get(args.trackedEntityId)
      ?.storageUnitId ?? null;
  if (!storageUnitId) return null;
  const { data } = await client
    .from("storageUnit")
    .select("name")
    .eq("id", storageUnitId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  return data?.name ?? null;
}
