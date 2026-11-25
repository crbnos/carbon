// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { ScrollArea } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction
} from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { issueWorkflowValidator } from "~/modules/quality/quality.models";
import IssueWorkflowForm from "~/modules/quality/ui/IssueWorkflows/IssueWorkflowForm";
import { toTiptapDoc } from "~/modules/shared/shared.models";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { recordMeta } from "~/utils/meta";
import { path } from "~/utils/path";

const logger = getLogger("erp", "id");

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Issue Workflows`, to: path.to.issueWorkflows },
    (data) => data?.workflow?.name
  )
};

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  recordMeta(data?.workflow?.name, "Issue Workflow");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId, api } = await authorize(
    request,
    { "quality.issueWorkflows": "View" },
    { bypassRls: true }
  );

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [workflow, requiredActions] = await Promise.all([
    api.quality.getIssueWorkflow({ nonConformanceWorkflowId: id }),
    api.quality.getRequiredActionsList({})
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

  // bypassRls makes `client` the service role, so the URL id is only proven to
  // exist — not to be this company's.
  if (workflow.data.companyId !== companyId) {
    logger.error("Issue workflow is not in the caller's company", {
      companyId,
      issueWorkflowId: id
    });
    throw redirect(path.to.issueWorkflows);
  }

  return {
    workflow: workflow.data,
    requiredActions: requiredActions.data ?? []
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(issueWorkflowValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { id: _, content, ...workflow } = input.data;
  const { api } = await authorize(args.request);
  const result = await api.quality.updateIssueWorkflow({
    ...workflow,
    id: input.params.id,
    // An untouched editor posts `{}`: an empty template.
    content: toTiptapDoc(content)
  });
  return respond(args.request, result).redirect(
    path.to.issueWorkflow(input.params.id),
    { message: "Non-conformance workflow updated" }
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
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] bg-card">
      <IssueWorkflowForm
        initialValues={initialValues}
        requiredActions={requiredActions}
        onClose={onClose}
      />
    </ScrollArea>
  );
}
