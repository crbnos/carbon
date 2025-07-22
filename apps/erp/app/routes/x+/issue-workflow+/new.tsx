import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { ScrollArea } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { issueWorkflowValidator } from "~/modules/quality/quality.models";
import { upsertIssueWorkflow } from "~/modules/quality/quality.service";
import IssueWorkflowForm from "~/modules/quality/ui/IssueWorkflows/IssueWorkflowForm";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "quality",
  });

  return null;
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

  const insertIssueWorkflow = await upsertIssueWorkflow(client, {
    ...data,
    companyId,
    createdBy: userId,
  });

  if (insertIssueWorkflow.error || !insertIssueWorkflow.data?.id) {
    return json(
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
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    content: "{}",
    priority: "Medium" as const,
    source: "Internal" as const,
    investigationTypes: [],
    requiredActions: [],
    approvalRequirements: [],
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)] bg-card">
      <IssueWorkflowForm
        initialValues={initialValues}
        onClose={() => navigate(-1)}
      />
    </ScrollArea>
  );
}
