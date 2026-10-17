// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { useUrlParams, useUser } from "~/hooks";
import { issueValidator } from "~/modules/quality/quality.models";
import {
  getIssueTypesList,
  getIssueWorkflowsList,
  getRequiredActionsList
} from "~/modules/quality/quality.service";
import IssueForm from "~/modules/quality/ui/Issue/IssueForm";
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(issueValidator).request(args);
  if ("invalid" in input) return input.invalid;
  // The "Create Issue from Inspection" button and a change notice's "Linked
  // Issue" combobox pass these on the query string.
  const url = new URL(args.request.url);
  const changeOrderId = url.searchParams.get("changeOrderId") ?? undefined;
  const api = await carbon(args.request);
  const result = await api.quality.createIssue({
    ...input.data,
    customFields: input.formData ? setCustomFields(input.formData) : undefined,
    trackedEntityIds: url.searchParams.get("trackedEntityIds")?.split(","),
    changeOrderId
  });
  if (result.error) {
    return respond(args.request, result).redirect(path.to.issues);
  }
  const { id, warning } = result.data;
  return respond(args.request, {
    error: warning ? { message: warning } : null
  }).redirect(
    changeOrderId ? path.to.changeNotice(changeOrderId) : path.to.issue(id)
  );
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
  // Prefilled when a change notice's "Linked Issue" combobox creates a new issue.
  const name = params.get("name");

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
    name: name ?? "",
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
    <NewRecordPage>
      <IssueForm
        initialValues={initialValues}
        nonConformanceWorkflows={workflows}
        nonConformanceTypes={types}
        requiredActions={requiredActions}
      />
    </NewRecordPage>
  );
}
