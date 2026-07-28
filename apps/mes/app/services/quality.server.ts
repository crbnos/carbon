import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getJobMakeMethod,
  getTrackedEntitiesByMakeMethodId,
  insertProductionQuantity
} from "~/services/operations.service";
import {
  getInspection,
  getInspectionMeasurements,
  getInspectionSamplingPlans
} from "~/services/quality.service";

type ServiceRole = Awaited<ReturnType<typeof getCarbonServiceRole>>;

export type ProductionEventIds = {
  setupProductionEventId?: string;
  laborProductionEventId?: string;
  machineProductionEventId?: string;
};

type IssueContext =
  | {
      ok: true;
      jobOperationId: string;
      operationOrder: string | null;
      jobId: string;
      jobReadableId: string;
      jobMakeMethodId: string | null;
      itemId: string | null;
      itemReadableId: string | null;
      locationId: string;
      issueTypeId: string;
      assignee: string | null;
    }
  | {
      ok: false;
      error: unknown;
      message: string;
    };

export type CreateQualityIssueArgs = {
  companyId: string;
  userId: string;
  jobOperationId: string;
  trackedEntityId?: string;
  // Falls back to "MES quality issue: {item}" when absent.
  name?: string;
  description?: string;
  // Falls back to the company's first issue type when absent.
  nonConformanceTypeId?: string;
  priority?: "Low" | "Medium" | "High" | "Critical";
  quantity?: number;
};

// MES-owned NCR creation for a job operation: sequence, nonConformance insert,
// the nonConformanceJobOperation / item / tracked-entity links, and the
// follow-up tasks edge function — with compensating deletes on failure.
// Extracted from the quality-issue.new route so the inspection reject route
// can create the same job-operation-aware issue.
export async function createQualityIssue(
  serviceRole: ServiceRole,
  args: CreateQualityIssueArgs
): Promise<
  | { data: { id: string }; error: null; message: null }
  | { data: null; error: unknown; message: string }
> {
  const { companyId, userId, jobOperationId } = args;
  const quantity =
    Number.isFinite(args.quantity) && (args.quantity ?? 0) > 0
      ? (args.quantity as number)
      : 1;

  const context = await getIssueContext(serviceRole, {
    companyId,
    userId,
    jobOperationId
  });

  if (!context.ok) {
    return { data: null, error: context.error, message: context.message };
  }

  const nextSequence = await serviceRole.rpc("get_next_sequence", {
    sequence_name: "nonConformance",
    company_id: companyId
  });

  if (nextSequence.error || !nextSequence.data) {
    return {
      data: null,
      error: nextSequence.error,
      message: "Failed to get quality issue sequence"
    };
  }

  const name =
    args.name ??
    `MES quality issue: ${context.itemReadableId ?? context.jobReadableId}`;

  const issue = await serviceRole
    .from("nonConformance")
    .insert({
      nonConformanceId: nextSequence.data,
      name,
      description: args.description ?? "",
      priority: args.priority ?? "Medium",
      source: "Internal",
      locationId: context.locationId,
      nonConformanceTypeId: args.nonConformanceTypeId ?? context.issueTypeId,
      nonConformanceWorkflowId: null,
      openDate: new Date().toISOString().slice(0, 10),
      quantity,
      assignee: context.assignee,
      requiredActionIds: [],
      approvalRequirements: [],
      companyId,
      createdBy: userId
    } satisfies Database["public"]["Tables"]["nonConformance"]["Insert"])
    .select("id")
    .single();

  if (issue.error || !issue.data?.id) {
    return {
      data: null,
      error: issue.error,
      message: "Failed to create quality issue"
    };
  }

  const nonConformanceId = issue.data.id;

  const [jobOperationAssociation, dispositionAssociation] = await Promise.all([
    serviceRole.from("nonConformanceJobOperation").insert({
      nonConformanceId,
      jobOperationId: context.jobOperationId,
      jobId: context.jobId,
      jobReadableId: context.jobReadableId,
      companyId,
      createdBy: userId
    }),
    linkIssueDispositionContext(serviceRole, {
      nonConformanceId,
      companyId,
      userId,
      itemId: context.itemId,
      jobMakeMethodId: context.jobMakeMethodId,
      trackedEntityId: args.trackedEntityId,
      quantity
    })
  ]);
  const associationError =
    jobOperationAssociation.error ?? dispositionAssociation.error;
  if (associationError) {
    await serviceRole
      .from("nonConformance")
      .delete()
      .eq("id", nonConformanceId);
    return {
      data: null,
      error: associationError,
      message: "Failed to link quality issue to MES context"
    };
  }

  const tasks = await serviceRole.functions.invoke("create", {
    body: {
      type: "nonConformanceTasks",
      id: nonConformanceId,
      companyId,
      userId
    }
  });

  if (tasks.error) {
    await serviceRole
      .from("nonConformance")
      .delete()
      .eq("id", nonConformanceId);
    return {
      data: null,
      error: tasks.error,
      message: "Failed to create quality issue tasks"
    };
  }

  return { data: { id: nonConformanceId }, error: null, message: null };
}

export type InspectionOutcomeSample = {
  id: string;
  trackedEntityId: string | null;
  status: string;
};

// Everything the disposition / complete-passed routes need to turn a verdict
// into physical postings, recomputed fresh from the DB on every POST (client
// form fields are operator intent, never trusted arithmetic).
export type InspectionOutcomeState = {
  inspection: any;
  jobOperationId: string;
  operation: Database["public"]["Tables"]["jobOperation"]["Row"];
  jobId: string;
  requiresSerialTracking: boolean;
  requiresBatchTracking: boolean;
  // The make method's batch WIP entity (batch-tracked completions accumulate
  // onto it via jobOperationBatchComplete).
  batchTrackedEntityId: string | null;
  // Ascending (createdAt, id) — the grid's column order and the completion
  // processing order.
  samples: InspectionOutcomeSample[];
  lotSize: number;
  // Production rows already linked to this inspection: per-sample links are
  // the serial double-count guard; the quantity sum is the non-serial one.
  linkedSampleIds: Set<string>;
  linkedProductionQuantity: number;
  // Operation quantity column bookkeeping. `opRemaining` nets out EVERY
  // posting — complete, scrapped, reworked, linked or not — so escape-hatch
  // menu postings can never be double-counted by the orchestration.
  opTarget: number;
  opAccounted: number;
  opRemaining: number;
  // Serial only: the make method's WIP entities and the eligibility test
  // (not Consumed, not Rejected, not already completed at this operation).
  entities: { id: string; status: string | null; attributes: unknown }[];
  entityEligible: (entityId: string) => boolean;
};

export async function getInspectionOutcomeState(
  serviceRole: ServiceRole,
  args: { inspectionId: string; companyId: string }
): Promise<
  | { data: InspectionOutcomeState; error: null; message: null }
  | { data: null; error: unknown; message: string }
> {
  const inspectionResult = await getInspection(serviceRole, args.inspectionId);
  if (inspectionResult.error || !inspectionResult.data) {
    return {
      data: null,
      error: inspectionResult.error,
      message: "Failed to load inspection"
    };
  }
  const inspection = inspectionResult.data as any;
  const jobOperationId = inspection.sourceDocumentLineId as string | null;
  if (inspection.sourceDocument !== "Job Operation" || !jobOperationId) {
    return {
      data: null,
      error: null,
      message: "Inspection is not a job operation lot"
    };
  }

  const [operationResult, linkedRows] = await Promise.all([
    serviceRole
      .from("jobOperation")
      .select("*")
      .eq("id", jobOperationId)
      .single(),
    serviceRole
      .from("productionQuantity")
      .select("id, type, quantity, inspectionSampleId")
      .eq("inspectionId", args.inspectionId)
  ]);
  if (operationResult.error || !operationResult.data) {
    return {
      data: null,
      error: operationResult.error,
      message: "Failed to load job operation"
    };
  }
  const operation = operationResult.data;
  if (operation.companyId !== args.companyId) {
    return {
      data: null,
      error: null,
      message: "Job operation is not in this company"
    };
  }

  const jobMakeMethod = operation.jobMakeMethodId
    ? await getJobMakeMethod(serviceRole, operation.jobMakeMethodId)
    : null;
  const requiresSerialTracking =
    jobMakeMethod?.data?.requiresSerialTracking ?? false;
  const requiresBatchTracking =
    jobMakeMethod?.data?.requiresBatchTracking ?? false;

  const trackedEntities =
    requiresSerialTracking && operation.jobMakeMethodId
      ? await getTrackedEntitiesByMakeMethodId(
          serviceRole,
          operation.jobMakeMethodId
        )
      : null;

  const samples: InspectionOutcomeSample[] = [
    ...((inspection.inspectionSample ?? []) as any[])
  ]
    .sort(
      (a, b) =>
        (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
        a.id.localeCompare(b.id)
    )
    .map((s) => ({
      id: s.id,
      trackedEntityId: s.trackedEntityId ?? null,
      status: s.status
    }));

  const productionRows = (linkedRows.data ?? []).filter(
    (r) => r.type === "Production"
  );
  const linkedSampleIds = new Set(
    productionRows
      .map((r) => r.inspectionSampleId)
      .filter((id): id is string => Boolean(id))
  );
  const linkedProductionQuantity = productionRows.reduce(
    (sum, r) => sum + (r.quantity ?? 0),
    0
  );

  const opTarget = operation.targetQuantity ?? operation.operationQuantity ?? 0;
  const opAccounted =
    (operation.quantityComplete ?? 0) +
    (operation.quantityScrapped ?? 0) +
    (operation.quantityReworked ?? 0);
  const opRemaining = Math.max(0, opTarget - opAccounted);

  const entities = (trackedEntities?.data ?? []).map((e) => ({
    id: e.id,
    status: e.status,
    attributes: e.attributes
  }));
  const opAttrKey = `Operation ${jobOperationId}`;
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const entityEligible = (entityId: string) => {
    const entity = entityById.get(entityId);
    if (!entity) return false;
    if (entity.status === "Consumed" || entity.status === "Rejected") {
      return false;
    }
    const attributes = (entity.attributes ?? {}) as Record<string, unknown>;
    return !attributes[opAttrKey];
  };

  return {
    data: {
      inspection,
      jobOperationId,
      operation,
      jobId: operation.jobId,
      requiresSerialTracking,
      requiresBatchTracking,
      batchTrackedEntityId: jobMakeMethod?.data?.trackedEntityId ?? null,
      samples,
      lotSize: Number(inspection.lotSize ?? 0),
      linkedSampleIds,
      linkedProductionQuantity,
      opTarget,
      opAccounted,
      opRemaining,
      entities,
      entityEligible
    },
    error: null,
    message: null
  };
}

// The serial units a completion pass may post, in ascending sample order:
// sampled units whose sample isn't linked yet, then (optionally) sample-less
// eligible units. Verdict-driven double-posting is impossible — the sample
// link's partial UNIQUE index guards sampled units, and the `Operation <opId>`
// entity attribute (via entityEligible) guards sample-less ones.
export function getSerialCompletionCandidates(
  state: InspectionOutcomeState,
  opts: {
    // Accept completes Pending-sampled units too (identify-only scans that
    // never failed); progressive complete-passed takes Passed only.
    includePending: boolean;
    // Accept sweeps un-sampled eligible units; Partial/complete-passed don't.
    includeSampleless: boolean;
    excludeEntityIds?: Set<string>;
  }
): { trackedEntityId: string; inspectionSampleId: string | null }[] {
  const candidates: {
    trackedEntityId: string;
    inspectionSampleId: string | null;
  }[] = [];
  const sampledEntityIds = new Set<string>();
  for (const sample of state.samples) {
    if (sample.trackedEntityId) sampledEntityIds.add(sample.trackedEntityId);
    const statusOk =
      sample.status === "Passed" ||
      (opts.includePending && sample.status === "Pending");
    if (!statusOk) continue;
    if (!sample.trackedEntityId) continue;
    if (state.linkedSampleIds.has(sample.id)) continue;
    if (!state.entityEligible(sample.trackedEntityId)) continue;
    if (opts.excludeEntityIds?.has(sample.trackedEntityId)) continue;
    candidates.push({
      trackedEntityId: sample.trackedEntityId,
      inspectionSampleId: sample.id
    });
  }
  if (opts.includeSampleless) {
    for (const entity of state.entities) {
      if (sampledEntityIds.has(entity.id)) continue;
      if (!state.entityEligible(entity.id)) continue;
      if (opts.excludeEntityIds?.has(entity.id)) continue;
      candidates.push({ trackedEntityId: entity.id, inspectionSampleId: null });
    }
  }
  return candidates;
}

// One `issue` serial-complete per unit (quantity 1), carrying the provenance
// links. Sequential on purpose: each complete mints the next Reserved entity
// and backflushes; stops at the first failure and reports how far it got.
export async function postSerialCompletions(
  serviceRole: ServiceRole,
  args: {
    candidates: {
      trackedEntityId: string;
      inspectionSampleId: string | null;
    }[];
    jobOperationId: string;
    inspectionId: string;
    eventIds: ProductionEventIds;
    companyId: string;
    userId: string;
  }
): Promise<{ completed: number; error: unknown | null }> {
  let completed = 0;
  for (const candidate of args.candidates) {
    const response = await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationSerialComplete",
        trackedEntityId: candidate.trackedEntityId,
        quantity: 1,
        jobOperationId: args.jobOperationId,
        inspectionId: args.inspectionId,
        ...(candidate.inspectionSampleId
          ? { inspectionSampleId: candidate.inspectionSampleId }
          : {}),
        ...args.eventIds,
        companyId: args.companyId,
        userId: args.userId
      }
    });
    if (response.error) return { completed, error: response.error };
    completed += 1;
  }
  return { completed, error: null };
}

// Non-serial completion: one bulk Production posting (batch entities
// accumulate via the issue edge fn; untracked inserts + backflushes here).
// The row links the inspection plus the lowest unlinked passed sample as a
// serializing representative — concurrent posts collide on the sample link's
// UNIQUE index instead of double-counting.
export async function postBulkCompletion(
  serviceRole: ServiceRole,
  client: SupabaseClient<Database>,
  state: InspectionOutcomeState,
  args: {
    quantity: number;
    eventIds: ProductionEventIds;
    companyId: string;
    userId: string;
  }
): Promise<{ error: unknown | null; message: string | null }> {
  const watermark = state.samples.find(
    (s) => s.status === "Passed" && !state.linkedSampleIds.has(s.id)
  );

  if (state.requiresBatchTracking && state.batchTrackedEntityId) {
    const response = await serviceRole.functions.invoke("issue", {
      body: {
        type: "jobOperationBatchComplete",
        trackedEntityId: state.batchTrackedEntityId,
        quantity: args.quantity,
        jobOperationId: state.jobOperationId,
        inspectionId: state.inspection.id,
        ...(watermark ? { inspectionSampleId: watermark.id } : {}),
        ...args.eventIds,
        companyId: args.companyId,
        userId: args.userId
      }
    });
    if (response.error) {
      return { error: response.error, message: "Failed to complete units" };
    }
    return { error: null, message: null };
  }

  const insertResult = await insertProductionQuantity(client, {
    jobOperationId: state.jobOperationId,
    quantity: args.quantity,
    inspectionId: state.inspection.id,
    ...(watermark ? { inspectionSampleId: watermark.id } : {}),
    ...args.eventIds,
    companyId: args.companyId,
    createdBy: args.userId
  });
  if (insertResult.error) {
    return {
      error: insertResult.error,
      message: "Failed to record production quantity"
    };
  }

  const issue = await serviceRole.functions.invoke("issue", {
    body: {
      id: state.jobOperationId,
      type: "jobOperation",
      quantity: args.quantity,
      companyId: args.companyId,
      userId: args.userId
    }
  });
  if (issue.error) {
    return {
      error: issue.error,
      message: "Units completed, but failed to issue materials"
    };
  }

  return { error: null, message: null };
}

// Auto-creates the optional NCR documenting a rejected (or partially rejected)
// inspection lot — failed features (measured values vs. spec) + sampling
// summary in the description — and links it back via nonConformanceInspection.
// Purely documentation: the physical outcome (scrap/rework/complete) is
// orchestrated by the disposition route, never by the NCR. Lifted from the
// retired inspection-lot reject route.
export async function createInspectionRejectionIssue(
  serviceRole: ServiceRole,
  args: {
    inspectionId: string;
    companyId: string;
    userId: string;
    nonConformanceTypeId?: string;
  }
): Promise<{ error: unknown | null; message: string | null }> {
  const { inspectionId, companyId, userId } = args;

  const inspection = await getInspection(serviceRole, inspectionId);
  if (inspection.error || !inspection.data) {
    return {
      error: inspection.error,
      message: "Failed to load the lot for the quality issue"
    };
  }
  const insp = inspection.data as any;
  const jobOperationId = insp.sourceDocumentLineId as string | null;
  if (!jobOperationId) {
    return { error: null, message: "Lot has no job operation to link" };
  }

  const inspectionReadableId = insp.inspectionId ?? "";
  const itemReadableId =
    insp.item?.readableId ?? insp.itemReadableId ?? insp.itemId;

  const issueTitle = [
    "Rejected lot",
    inspectionReadableId,
    itemReadableId && `— ${itemReadableId}`,
    insp.sourceDocumentReadableId && `on ${insp.sourceDocumentReadableId}`
  ]
    .filter(Boolean)
    .join(" ");

  // Document-driven lots: attach the failed features (measured values
  // vs. spec) so MRB sees what failed and by how much without re-measuring.
  const [lotFeatures, lotMeasurements] = await Promise.all([
    getInspectionSamplingPlans(serviceRole, inspectionId, companyId),
    getInspectionMeasurements(serviceRole, inspectionId, companyId)
  ]);
  const failedFeatureLines: string[] = [];
  for (const lotFeature of lotFeatures.data ?? []) {
    const feature = lotFeature.inspectionFeature;
    if (!feature) continue;
    const featureMeasurements = (lotMeasurements.data ?? []).filter(
      (m) => m.inspectionFeatureId === feature.id
    );
    const recorded = featureMeasurements.filter(
      (m) => m.status !== "Pending"
    ).length;
    const failed = featureMeasurements.filter((m) => m.status === "Failed");
    if (failed.length === 0) continue;
    const failedValues = failed
      .map((m) => (m.value == null ? "F" : String(m.value)))
      .join(", ");
    const spec = [
      feature.nominalValue,
      feature.tolerancePlus != null || feature.toleranceMinus != null
        ? `+${feature.tolerancePlus ?? "0"}/−${feature.toleranceMinus ?? "0"}`
        : null,
      feature.unit
    ]
      .filter(Boolean)
      .join(" ");
    failedFeatureLines.push(
      spec
        ? `- ${feature.label}: nominal ${spec} — failed values: ${failedValues} (${failed.length}/${recorded} failed, n=${lotFeature.sampleSize}, Ac=${lotFeature.acceptanceNumber})`
        : `- ${feature.label}: ${failed.length}/${recorded} failed (n=${lotFeature.sampleSize}, Ac=${lotFeature.acceptanceNumber})`
    );
  }
  const failedFeaturesBlock =
    failedFeatureLines.length > 0
      ? `\n\nFailed features:\n${failedFeatureLines.join("\n")}`
      : "";

  const issue = await createQualityIssue(serviceRole, {
    companyId,
    userId,
    jobOperationId,
    nonConformanceTypeId: args.nonConformanceTypeId,
    name: issueTitle,
    description: `Auto-created from inspection ${inspectionReadableId}. Lot size ${insp.lotSize}, sample ${insp.sampleSize}, Ac ${insp.acceptanceNumber} / Re ${insp.rejectionNumber}.${failedFeaturesBlock}`,
    priority: "Medium",
    quantity: Number(insp.lotSize ?? 1)
  });

  if (issue.error || !issue.data) {
    return {
      error: issue.error,
      message: issue.message ?? "Failed to create quality issue"
    };
  }

  // Link the source inspection to the issue so the ERP issue explorer can
  // surface the origin and deep-link back to the inspection lot.
  const link = await serviceRole.from("nonConformanceInspection").insert({
    nonConformanceId: issue.data.id,
    inspectionId,
    companyId,
    createdBy: userId
  });
  if (link.error) {
    return {
      error: link.error,
      message: "Quality issue created, but failed to link the inspection"
    };
  }

  return { error: null, message: null };
}

async function getIssueContext(
  client: ServiceRole,
  args: {
    companyId: string;
    userId: string;
    jobOperationId: string;
  }
): Promise<IssueContext> {
  const operation = await client
    .from("jobOperation")
    .select("id, companyId, jobId, jobMakeMethodId, operationOrder")
    .eq("id", args.jobOperationId)
    .maybeSingle();

  if (operation.error || !operation.data) {
    return {
      ok: false,
      error: operation.error,
      message: "Failed to load job operation"
    };
  }

  if (operation.data.companyId !== args.companyId) {
    return {
      ok: false,
      error: null,
      message: "Job operation is not in this company"
    };
  }

  const [job, defaults, issueType] = await Promise.all([
    client
      .from("job")
      .select("id, jobId, itemId, locationId, assignee")
      .eq("id", operation.data.jobId)
      .maybeSingle(),
    client
      .from("userDefaults")
      .select("locationId")
      .eq("userId", args.userId)
      .eq("companyId", args.companyId)
      .maybeSingle(),
    client
      .from("nonConformanceType")
      .select("id")
      .eq("companyId", args.companyId)
      .order("name", { ascending: true })
      .limit(1)
      .maybeSingle()
  ]);

  if (job.error || !job.data) {
    return {
      ok: false,
      error: job.error,
      message: "Failed to load job context"
    };
  }

  if (issueType.error || !issueType.data?.id) {
    return {
      ok: false,
      error: issueType.error,
      message:
        "Configure at least one quality issue type before creating MES issues"
    };
  }

  const locationId = defaults.data?.locationId ?? job.data.locationId;
  if (!locationId) {
    return {
      ok: false,
      error: defaults.error,
      message: "A location is required to create a quality issue"
    };
  }

  const item = job.data.itemId
    ? await client
        .from("item")
        .select("readableId, name")
        .eq("id", job.data.itemId)
        .maybeSingle()
    : null;

  return {
    ok: true,
    jobOperationId: operation.data.id,
    operationOrder: operation.data.operationOrder,
    jobId: job.data.id,
    jobReadableId: job.data.jobId,
    jobMakeMethodId: operation.data.jobMakeMethodId,
    itemId: job.data.itemId,
    itemReadableId:
      item?.data?.readableId ?? item?.data?.name ?? job.data.itemId ?? null,
    locationId,
    issueTypeId: issueType.data.id,
    assignee: job.data.assignee
  };
}

async function linkIssueDispositionContext(
  client: ServiceRole,
  args: {
    nonConformanceId: string;
    companyId: string;
    userId: string;
    itemId: string | null;
    jobMakeMethodId: string | null;
    trackedEntityId?: string;
    quantity: number;
  }
): Promise<{ error: unknown | null }> {
  const {
    nonConformanceId,
    companyId,
    userId,
    itemId,
    jobMakeMethodId,
    trackedEntityId,
    quantity
  } = args;

  if (!itemId) return { error: null };

  const trackedEntities = await getTrackedEntitiesForIssue(client, {
    companyId,
    jobMakeMethodId,
    trackedEntityId
  });

  if (trackedEntities.error) {
    return { error: trackedEntities.error };
  }

  const itemQuantity =
    trackedEntities.data.length > 0
      ? trackedEntities.data.reduce(
          (total, entity) => total + Number(entity.quantity ?? quantity),
          0
        )
      : quantity;

  const item = await client
    .from("nonConformanceItem")
    .insert({
      nonConformanceId,
      itemId,
      quantity: itemQuantity,
      disposition: "Pending",
      companyId,
      createdBy: userId
    })
    .select("id")
    .single();

  if (item.error || !item.data?.id) {
    return { error: item.error ?? new Error("Failed to create issue item") };
  }

  if (trackedEntities.data.length === 0) {
    return { error: null };
  }

  const trackedEntityLinks = await client
    .from("nonConformanceTrackedEntity")
    .insert(
      trackedEntities.data.map((entity) => ({
        nonConformanceId,
        trackedEntityId: entity.id,
        companyId,
        createdBy: userId
      }))
    );

  if (trackedEntityLinks.error) {
    return { error: trackedEntityLinks.error };
  }

  const dispositionLinks = await client
    .from("nonConformanceItemTrackedEntity")
    .insert(
      trackedEntities.data.map((entity) => ({
        nonConformanceItemId: item.data.id,
        nonConformanceId,
        trackedEntityId: entity.id,
        quantity: Number(entity.quantity ?? quantity),
        companyId,
        createdBy: userId
      }))
    );

  return { error: dispositionLinks.error };
}

async function getTrackedEntitiesForIssue(
  client: ServiceRole,
  args: {
    companyId: string;
    jobMakeMethodId: string | null;
    trackedEntityId?: string;
  }
): Promise<{
  data: { id: string; quantity: number | null }[];
  error: unknown | null;
}> {
  if (!args.trackedEntityId) {
    return { data: [], error: null };
  }

  const entity = await client
    .from("trackedEntity")
    .select("id, quantity")
    .eq("id", args.trackedEntityId)
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (entity.error) {
    return { data: [], error: entity.error };
  }

  if (!entity.data) {
    return {
      data: [],
      error: new Error("Tracked entity is not in this company")
    };
  }

  return { data: [entity.data], error: null };
}
