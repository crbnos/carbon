import { assertIsPost, ERP_URL, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { notifyIssueCreated } from "@carbon/ee/notifications";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { useUrlParams, useUser } from "~/hooks";
import {
  deleteIssue,
  getIssueTypesList,
  getIssueWorkflowsList,
  getRequiredActionsList,
  insertIssue,
  issueValidator
} from "~/modules/quality";
import IssueForm from "~/modules/quality/ui/Issue/IssueForm";
import { getCompanyIntegrations } from "~/modules/settings/settings.server";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Issues`,
  to: path.to.issues
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality"
  });

  const [workflows, types, requiredActions] = await Promise.all([
    getIssueWorkflowsList(client, companyId),
    getIssueTypesList(client, companyId),
    getRequiredActionsList(client, companyId)
  ]);

  return {
    workflows: workflows.data ?? [],
    types: types.data ?? [],
    requiredActions: requiredActions.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality"
  });

  const serviceRole = await getCarbonServiceRole();

  const formData = await request.formData();
  const validation = await validator(issueValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const d = validation.data;

  const createResult = await insertIssue(serviceRole, {
    nonConformanceId: d.nonConformanceId || undefined,
    name: d.name,
    priority: d.priority,
    source: d.source,
    locationId: d.locationId,
    nonConformanceTypeId: d.nonConformanceTypeId,
    openDate: d.openDate,
    description: d.description,
    nonConformanceWorkflowId: d.nonConformanceWorkflowId,
    dueDate: d.dueDate,
    closeDate: d.closeDate,
    quantity: d.quantity,
    requiredActionIds: d.requiredActionIds,
    approvalRequirements: d.approvalRequirements,
    items: d.items,
    jobOperationId: d.jobOperationId,
    customerId: d.customerId,
    salesOrderLineId: d.salesOrderLineId,
    operationSupplierProcessId: d.operationSupplierProcessId,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createResult.error || !createResult.data) {
    throw redirect(
      path.to.issues,
      await flash(request, error(createResult.error, "Failed to insert issue"))
    );
  }

  const ncrId = createResult.data.id;

  // Pre-associate tracked entities passed via query string (used by the
  // "Create Issue from Inspection" button on inbound inspection lots).
  const url = new URL(request.url);
  const trackedEntityIdsParam = url.searchParams.get("trackedEntityIds");
  const trackedEntityIds = trackedEntityIdsParam
    ? trackedEntityIdsParam.split(",").filter(Boolean)
    : [];
  if (trackedEntityIds.length > 0) {
    await serviceRole.from("nonConformanceTrackedEntity").insert(
      trackedEntityIds.map((trackedEntityId) => ({
        nonConformanceId: ncrId,
        trackedEntityId,
        companyId,
        createdBy: userId
      }))
    );
  }

  // When the NCR is filed against a specific job operation, surface the
  // tracked entity produced by that operation's make method onto a
  // disposition row so the MRB can immediately scrap/rework/use-as-is it.
  if (validation.data.jobOperationId) {
    await autoLinkJobOperationDisposition(serviceRole, {
      nonConformanceId: ncrId,
      companyId,
      userId,
      jobOperationId: validation.data.jobOperationId
    });
  }

  const tasks = await serviceRole.functions.invoke("create", {
    body: {
      type: "nonConformanceTasks",
      id: ncrId,
      companyId,
      userId
    }
  });

  if (tasks.error) {
    await deleteIssue(serviceRole, ncrId);
    throw redirect(
      path.to.issue(ncrId!),
      await flash(request, error("Failed to create tasks"))
    );
  }

  try {
    const integrations = await getCompanyIntegrations(client, companyId);
    await notifyIssueCreated({ client, serviceRole }, integrations, {
      companyId,
      userId,
      carbonUrl: `${ERP_URL}${path.to.issue(ncrId)}`,
      issue: {
        id: ncrId,
        nonConformanceId: createResult.data.nonConformanceId,
        title: validation.data.name,
        description: validation.data.description ?? "",
        severity: validation.data.priority
      }
    });
  } catch (error) {
    console.error("Failed to send notifications:", error);
  }

  throw redirect(path.to.issue(ncrId!));
}

export default function IssueNewRoute() {
  const { workflows, types, requiredActions } = useLoaderData<typeof loader>();

  const { defaults } = useUser();
  const [params] = useUrlParams();
  const supplierId = params.get("supplierId");
  const customerId = params.get("customerId");
  const jobId = params.get("jobId");
  const jobOperationId = params.get("jobOperationId");
  const itemId = params.get("itemId");
  const salesOrderId = params.get("salesOrderId");
  const shipmentId = params.get("shipmentId");
  const purchaseOrderId = params.get("purchaseOrderId");
  const purchaseOrderLineId = params.get("purchaseOrderLineId");
  const salesOrderLineId = params.get("salesOrderLineId");
  const shipmentLineId = params.get("shipmentLineId");
  const operationSupplierProcessId = params.get("operationSupplierProcessId");

  const initialValues = {
    id: undefined,
    nonConformanceId: undefined,
    approvalRequirements: [],
    customerId: customerId ?? "",
    items: itemId ? [itemId] : [],
    jobId: jobId ?? "",
    jobOperationId: jobOperationId ?? "",
    itemId: itemId ?? "",
    locationId: defaults.locationId ?? "",
    name: "",
    nonConformanceTypeId: "",
    nonConformanceWorkflowId: "",
    openDate: today(getLocalTimeZone()).toString(),
    priority: "Medium" as const,
    purchaseOrderId: purchaseOrderId ?? "",
    purchaseOrderLineId: purchaseOrderLineId ?? "",
    quantity: 1,
    requiredActionIds: [],
    salesOrderId: salesOrderId ?? "",
    salesOrderLineId: salesOrderLineId ?? "",
    shipmentId: shipmentId ?? "",
    shipmentLineId: shipmentLineId ?? "",
    source: "Internal" as const,
    supplierId: supplierId ?? "",
    trackedEntityId: "",
    operationSupplierProcessId: operationSupplierProcessId ?? ""
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <IssueForm
        initialValues={initialValues}
        nonConformanceWorkflows={workflows}
        nonConformanceTypes={types}
        requiredActions={requiredActions}
      />
    </div>
  );
}

async function autoLinkJobOperationDisposition(
  client: Awaited<ReturnType<typeof getCarbonServiceRole>>,
  args: {
    nonConformanceId: string;
    companyId: string;
    userId: string;
    jobOperationId: string;
  }
) {
  const { nonConformanceId, companyId, userId, jobOperationId } = args;

  const operation = await client
    .from("jobOperation")
    .select("jobMakeMethodId")
    .eq("id", jobOperationId)
    .single();
  const jobMakeMethodId = operation.data?.jobMakeMethodId ?? null;
  if (!jobMakeMethodId) return;

  const makeMethod = await client
    .from("jobMakeMethod")
    .select("itemId")
    .eq("id", jobMakeMethodId)
    .single();
  const itemId = makeMethod.data?.itemId ?? null;
  if (!itemId) return;

  const entities = await client
    .from("trackedEntity")
    .select("id, quantity")
    .eq("attributes->>Job Make Method", jobMakeMethodId)
    .eq("companyId", companyId);
  const lotEntities = (entities.data ?? []) as {
    id: string;
    quantity: number | null;
  }[];
  if (lotEntities.length === 0) return;

  const entityIds = lotEntities.map((e) => e.id);

  // NCR-level link (mirrors the explorer's autoLinkJobOperationContext so the
  // entities show up under "Tracked Entities" in the issue explorer).
  const existingNcrLinks = await client
    .from("nonConformanceTrackedEntity")
    .select("trackedEntityId")
    .eq("nonConformanceId", nonConformanceId)
    .in("trackedEntityId", entityIds);
  const alreadyOnNcr = new Set(
    (existingNcrLinks.data ?? []).map((r) => r.trackedEntityId as string)
  );
  const ncrLinkRows = entityIds
    .filter((id) => !alreadyOnNcr.has(id))
    .map((trackedEntityId) => ({
      nonConformanceId,
      trackedEntityId,
      companyId,
      createdBy: userId
    }));
  if (ncrLinkRows.length > 0) {
    const ncrInsert = await client
      .from("nonConformanceTrackedEntity")
      .insert(ncrLinkRows);
    if (ncrInsert.error) {
      console.error(ncrInsert.error);
      return;
    }
  }

  // Disposition row: find or create. insertIssue may have already inserted
  // one for this item via the form's `items` array.
  const existingItem = await client
    .from("nonConformanceItem")
    .select("id, quantity")
    .eq("nonConformanceId", nonConformanceId)
    .eq("itemId", itemId)
    .maybeSingle();

  let itemRowId: string;
  let currentQty: number;
  if (existingItem.data) {
    itemRowId = existingItem.data.id as string;
    currentQty = Number(existingItem.data.quantity ?? 0);
  } else {
    const insert = await (client as any)
      .from("nonConformanceItem")
      .insert({
        itemId,
        nonConformanceId,
        createdBy: userId,
        companyId,
        quantity: 0
      })
      .select("id, quantity")
      .single();
    if (insert.error || !insert.data) {
      console.error(insert.error);
      return;
    }
    itemRowId = insert.data.id as string;
    currentQty = Number(insert.data.quantity ?? 0);
  }

  // ncUnique: an entity may sit on at most one disposition row per NCR.
  const alreadyLinked = await (client as any)
    .from("nonConformanceItemTrackedEntity")
    .select("trackedEntityId")
    .eq("nonConformanceId", nonConformanceId)
    .in("trackedEntityId", entityIds);
  const alreadyLinkedSet = new Set(
    ((alreadyLinked.data ?? []) as { trackedEntityId: string }[]).map(
      (r) => r.trackedEntityId
    )
  );

  const linkRows = lotEntities
    .filter((e) => !alreadyLinkedSet.has(e.id))
    .map((e) => ({
      nonConformanceItemId: itemRowId,
      trackedEntityId: e.id,
      quantity: Number(e.quantity ?? 1),
      companyId,
      createdBy: userId
    }));
  if (linkRows.length === 0) return;

  const linkInsert = await (client as any)
    .from("nonConformanceItemTrackedEntity")
    .insert(linkRows);
  if (linkInsert.error) {
    console.error(linkInsert.error);
    return;
  }

  const addedQty = linkRows.reduce((acc, r) => acc + r.quantity, 0);
  await client
    .from("nonConformanceItem")
    .update({
      quantity: currentQty + addedQty,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", itemRowId)
    .eq("companyId", companyId);
}
