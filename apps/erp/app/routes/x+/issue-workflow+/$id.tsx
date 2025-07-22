import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";

import { ScrollArea } from "@carbon/react";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getIssueWorkflow,
  issueWorkflowValidator,
  upsertIssueWorkflow,
} from "~/modules/quality";
import IssueWorkflowForm from "~/modules/quality/ui/IssueWorkflows/IssueWorkflowForm";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Issue Workflows",
  to: path.to.issueWorkflows,
  module: "quality",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
    bypassRls: true,
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [workflow] = await Promise.all([getIssueWorkflow(client, id)]);

  if (workflow.error) {
    throw redirect(
      path.to.issueWorkflows,
      await flash(
        request,
        error(workflow.error, "Failed to load issue workflow")
      )
    );
  }

  return json({
    workflow: workflow.data,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality",
  });
  const formData = await request.formData();
  const validation = await validator(issueWorkflowValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("Could not find id");

  const updateIssueWorkflow = await upsertIssueWorkflow(client, {
    id,
    ...data,
    companyId,
    updatedBy: userId,
  });

  if (updateIssueWorkflow.error) {
    console.error(updateIssueWorkflow.error);
    return json(
      {},
      await flash(
        request,
        error(updateIssueWorkflow.error, "Failed to update issue workflow")
      )
    );
  }

  return json(
    {},
    await flash(request, success("Non-conformance workflow updated"))
  );
}

export default function IssueWorkflowRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const loaderData = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => {
    navigate(path.to.issueWorkflows);
  };

  const initialValues = {
    id: loaderData?.workflow?.id,
    name: loaderData?.workflow?.name,
    content: JSON.stringify(loaderData?.workflow?.content),
    priority: (loaderData?.workflow?.priority ?? "Medium") as "Medium",
    source: (loaderData?.workflow?.source ?? "Internal") as "Internal",
    investigationTypes: loaderData?.workflow?.investigationTypes ?? [],
    requiredActions: loaderData?.workflow?.requiredActions ?? [],
    approvalRequirements: loaderData?.workflow?.approvalRequirements ?? [],
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)] bg-card">
      <IssueWorkflowForm initialValues={initialValues} onClose={onClose} />
    </ScrollArea>
  );
}
