import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { ScrollArea } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { issueWorkflowValidator } from "~/modules/quality/quality.models";
import {
  getRequiredActionsList,
  upsertIssueWorkflow
} from "~/modules/quality/quality.service";
import IssueWorkflowForm from "~/modules/quality/ui/IssueWorkflows/IssueWorkflowForm";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "quality"
  });

  const requiredActions = await getRequiredActionsList(client, companyId);

  return {
    requiredActions: requiredActions.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality"
  });
  const formData = await request.formData();
  const validation = await validator(issueWorkflowValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insertIssueWorkflow = await upsertIssueWorkflow(client, {
    ...d,
    companyId,
    createdBy: userId
  });

  if (insertIssueWorkflow.error || !insertIssueWorkflow.data?.id) {
    return data(
      {},
      await flash(
        request,
        error(insertIssueWorkflow.error, "Failed to insert issue workflow")
      )
    );
  }

  throw redirect(
    path.to.issueWorkflow(insertIssueWorkflow.data.id),
    await flash(request, success("Non-conformance workflow created"))
  );
}

export default function NewIssueWorkflowRoute() {
  const { requiredActions } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    content: "{}",
    priority: "Medium" as const,
    source: "Internal" as const,
    requiredActionIds: [],
    approvalRequirements: []
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] bg-card">
      <IssueWorkflowForm
        initialValues={initialValues}
        requiredActions={requiredActions}
        onClose={() => navigate(-1)}
      />
    </ScrollArea>
  );
}
