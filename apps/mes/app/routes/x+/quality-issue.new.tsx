import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path, requestReferrer } from "~/utils/path";

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

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "quality"
  });
  const serviceRole = await getCarbonServiceRole();

  const formData = await request.formData();
  const jobOperationId = getRequiredFormValue(formData, "jobOperationId");
  const trackedEntityId = getOptionalFormValue(formData, "trackedEntityId");
  const userDescription = getOptionalFormValue(formData, "description");
  const nonConformanceTypeId = getOptionalFormValue(
    formData,
    "nonConformanceTypeId"
  );
  const priority = getOptionalFormValue(formData, "priority") as
    | "Low"
    | "Medium"
    | "High"
    | "Critical"
    | undefined;
  const quantity = normalizeQuantity(
    getOptionalFormValue(formData, "quantity")
  );

  if (!jobOperationId) {
    throw redirect(
      requestReferrer(request) ?? path.to.active,
      await flash(request, error(null, "Job operation is required"))
    );
  }

  const context = await getIssueContext(serviceRole, {
    companyId,
    userId,
    jobOperationId
  });

  if (!context.ok) {
    throw redirect(
      requestReferrer(request) ?? path.to.active,
      await flash(request, error(context.error, context.message))
    );
  }

  const nextSequence = await serviceRole.rpc("get_next_sequence", {
    sequence_name: "nonConformance",
    company_id: companyId
  });

  if (nextSequence.error || !nextSequence.data) {
    throw redirect(
      requestReferrer(request) ?? path.to.active,
      await flash(
        request,
        error(nextSequence.error, "Failed to get quality issue sequence")
      )
    );
  }

  const name =
    userDescription ??
    `MES quality issue: ${context.itemReadableId ?? context.jobReadableId}`;

  const issue = await serviceRole
    .from("nonConformance")
    .insert({
      nonConformanceId: nextSequence.data,
      name,
      description: "",
      priority: priority ?? "Medium",
      source: "Internal",
      locationId: context.locationId,
      nonConformanceTypeId: nonConformanceTypeId ?? context.issueTypeId,
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
    throw redirect(
      requestReferrer(request) ?? path.to.active,
      await flash(request, error(issue.error, "Failed to create quality issue"))
    );
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
      trackedEntityId,
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
    throw redirect(
      requestReferrer(request) ?? path.to.active,
      await flash(
        request,
        error(associationError, "Failed to link quality issue to MES context")
      )
    );
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
    throw redirect(
      requestReferrer(request) ?? path.to.active,
      await flash(
        request,
        error(tasks.error, "Failed to create quality issue tasks")
      )
    );
  }

  return success("Quality issue created");
}

function getRequiredFormValue(formData: FormData, key: string) {
  return (formData.get(key) as string | null)?.trim() ?? "";
}

function getOptionalFormValue(formData: FormData, key: string) {
  return (formData.get(key) as string | null)?.trim() || undefined;
}

function normalizeQuantity(value: string | undefined) {
  const quantity = Number(value ?? "1");
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
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
