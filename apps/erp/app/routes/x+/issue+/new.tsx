import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useLoaderData } from "@remix-run/react";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useUrlParams, useUser } from "~/hooks";
import {
  deleteIssue,
  getIssueTypesList,
  getIssueWorkflowsList,
  issueValidator,
  upsertIssue,
} from "~/modules/quality";
import IssueForm from "~/modules/quality/ui/Issue/IssueForm";

import { getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Issues",
  to: path.to.issues,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
  });

  const [workflows, types] = await Promise.all([
    getIssueWorkflowsList(client, companyId),
    getIssueTypesList(client, companyId),
  ]);

  return json({
    workflows: workflows.data ?? [],
    types: types.data ?? [],
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "quality",
  });

  const serviceRole = await getCarbonServiceRole();

  const formData = await request.formData();
  const validation = await validator(issueValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const nextSequence = await getNextSequence(
    serviceRole,
    "nonConformance",
    companyId
  );
  if (nextSequence.error) {
    throw redirect(
      path.to.newIssue,
      await flash(
        request,
        error(nextSequence.error, "Failed to get next sequence")
      )
    );
  }

  const { id, ...nonConformance } = validation.data;

  const createIssue = await upsertIssue(serviceRole, {
    ...nonConformance,
    nonConformanceId: nextSequence.data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createIssue.error || !createIssue.data) {
    throw redirect(
      path.to.issues,
      await flash(request, error(createIssue.error, "Failed to insert issue"))
    );
  }

  const ncrId = createIssue.data?.id;
  if (!ncrId) {
    throw redirect(
      path.to.issues,
      await flash(request, error("Failed to insert issue"))
    );
  }

  const tasks = await serviceRole.functions.invoke("create", {
    body: {
      type: "nonConformanceTasks",
      id: ncrId,
      companyId,
      userId,
    },
    region: FunctionRegion.UsEast1,
  });

  if (tasks.error) {
    await deleteIssue(serviceRole, ncrId);
    throw redirect(
      path.to.issue(ncrId!),
      await flash(request, error("Failed to create tasks"))
    );
  }
  throw redirect(path.to.issue(ncrId!));
}

export default function IssueNewRoute() {
  const { workflows, types } = useLoaderData<typeof loader>();

  const { defaults } = useUser();
  const [params] = useUrlParams();
  const supplierId = params.get("supplierId");
  const customerId = params.get("customerId");
  const jobId = params.get("jobId");
  const salesOrderId = params.get("salesOrderId");
  const shipmentId = params.get("shipmentId");
  const purchaseOrderId = params.get("purchaseOrderId");
  const purchaseOrderLineId = params.get("purchaseOrderLineId");
  const salesOrderLineId = params.get("salesOrderLineId");
  const shipmentLineId = params.get("shipmentLineId");

  const initialValues = {
    id: undefined,
    nonConformanceId: undefined,
    approvalRequirements: [],
    customerId: customerId ?? "",
    investigationTypes: [],
    itemId: "",
    jobId: jobId ?? "",
    locationId: defaults.locationId ?? "",
    name: "",
    nonConformanceTypeId: "",
    nonConformanceWorkflowId: "",
    openDate: today(getLocalTimeZone()).toString(),
    priority: "Medium" as const,
    purchaseOrderId: purchaseOrderId ?? "",
    purchaseOrderLineId: purchaseOrderLineId ?? "",
    quantity: 1,
    requiredActions: [],
    salesOrderId: salesOrderId ?? "",
    salesOrderLineId: salesOrderLineId ?? "",
    shipmentId: shipmentId ?? "",
    shipmentLineId: shipmentLineId ?? "",
    source: "Internal" as const,
    supplierId: supplierId ?? "",
    trackedEntityId: "",
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <IssueForm
        initialValues={initialValues}
        nonConformanceWorkflows={workflows}
        nonConformanceTypes={types}
      />
    </div>
  );
}
