import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { ScrollArea } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import {
  getIssueWorkflow,
  getRequiredActionsList,
  issueWorkflowValidator,
  upsertIssueWorkflow
} from "~/modules/quality";
import IssueWorkflowForm from "~/modules/quality/ui/IssueWorkflows/IssueWorkflowForm";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "id");

export const handle: Handle = {
  breadcrumb: msg`Issue Workflows`,
  to: path.to.issueWorkflows,
  module: "quality"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [workflow, requiredActions] = await Promise.all([
    getIssueWorkflow(client, id),
    getRequiredActionsList(client, companyId)
  ]);

  if (workflow.error) {
    throw redirect(
      path.to.issueWorkflows,
      await flash(
        request,
        error(workflow.error, "Failed to load issue workflow")
      )
    );
  }

  return {
    workflow: workflow.data,
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

  const { id, ...d } = validation.data;
  if (!id) throw new Error("Could not find id");

  const updateIssueWorkflow = await upsertIssueWorkflow(client, {
    id,
    ...d,
    companyId,
    updatedBy: userId
  });

  if (updateIssueWorkflow.error) {
    logger.error(updateIssueWorkflow.error);
    return data(
      {},
      await flash(
        request,
        error(updateIssueWorkflow.error, "Failed to update issue workflow")
      )
    );
  }

  return data(
    {},
    await flash(request, success("Non-conformance workflow updated"))
  );
}

export default function IssueWorkflowRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { workflow, requiredActions } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => {
    navigate(path.to.issueWorkflows);
  };

  const initialValues = {
    id: workflow?.id,
    name: workflow?.name,
    content: JSON.stringify(workflow?.content),
    priority: (workflow?.priority ?? "Medium") as "Medium",
    source: (workflow?.source ?? "Internal") as "Internal",
    requiredActionIds: workflow?.requiredActionIds ?? [],
    approvalRequirements: workflow?.approvalRequirements ?? []
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)] bg-card">
      <IssueWorkflowForm
        initialValues={initialValues}
        requiredActions={requiredActions}
        onClose={onClose}
      />
    </ScrollArea>
  );
}
