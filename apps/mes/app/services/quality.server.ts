import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";

type ServiceRole = Awaited<ReturnType<typeof getCarbonServiceRole>>;

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
