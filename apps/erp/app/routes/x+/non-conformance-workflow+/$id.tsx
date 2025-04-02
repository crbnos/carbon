import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator, validationError } from "@carbon/form";

import { ScrollArea } from "@carbon/react";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getNonConformanceWorkflow,
  nonConformanceWorkflowValidator,
  upsertNonConformanceWorkflow,
} from "~/modules/quality";
import NonConformanceWorkflowForm from "~/modules/quality/ui/NonConformanceWorkflows/NonConformanceWorkflowForm";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Non-Conformance Workflows",
  to: path.to.nonConformanceWorkflows,
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

  const [workflow] = await Promise.all([getNonConformanceWorkflow(client, id)]);

  if (workflow.error) {
    throw redirect(
      path.to.nonConformanceWorkflows,
      await flash(request, error(workflow.error, "Failed to load NCR workflow"))
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
  const validation = await validator(nonConformanceWorkflowValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("Could not find id");

  const updateNonConformanceWorkflow = await upsertNonConformanceWorkflow(
    client,
    {
      id,
      ...data,
      companyId,
      updatedBy: userId,
    }
  );

  if (updateNonConformanceWorkflow.error) {
    console.error(updateNonConformanceWorkflow.error);
    return json(
      {},
      await flash(
        request,
        error(
          updateNonConformanceWorkflow.error,
          "Failed to update non-conformance workflow"
        )
      )
    );
  }

  return json(
    {},
    await flash(request, success("Non-conformance workflow updated"))
  );
}

export default function NonConformanceWorkflowRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const loaderData = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => {
    navigate(path.to.nonConformanceWorkflows);
  };

  const initialValues = {
    id: loaderData?.workflow?.id,
    name: loaderData?.workflow?.name,
    content: JSON.stringify(loaderData?.workflow?.content),
    investigationTypes: loaderData?.workflow?.investigationTypes ?? [],
    requiredActions: loaderData?.workflow?.requiredActions ?? [],
    approvalRequirements: loaderData?.workflow?.approvalRequirements ?? [],
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)] bg-card">
      <NonConformanceWorkflowForm
        initialValues={initialValues}
        onClose={onClose}
      />
    </ScrollArea>
  );
}
