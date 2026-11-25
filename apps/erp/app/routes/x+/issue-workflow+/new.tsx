// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { ScrollArea, useCloseRoute, useViewport } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useSetAppBarOverride } from "~/components/Layout/Mobile";
import { issueWorkflowValidator } from "~/modules/quality/quality.models";
import { getRequiredActionsList } from "~/modules/quality/quality.service";
import IssueWorkflowForm from "~/modules/quality/ui/IssueWorkflows/IssueWorkflowForm";
import { toTiptapDoc } from "~/modules/shared/shared.models";
import { newRecordMeta } from "~/utils/meta";
import { path } from "~/utils/path";

export const meta = newRecordMeta("Issue Workflow");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await authorize(request, {
    "quality.issueWorkflows": "Create"
  });
  const requiredActions = await getRequiredActionsList(client, companyId);

  return {
    requiredActions: requiredActions.data ?? []
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(issueWorkflowValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _, content, ...workflow } = input.data;
  const { api } = await authorize(args.request);
  const result = await api.quality.createIssueWorkflow({
    ...workflow,
    // An untouched editor posts `{}`: an empty template.
    content: toTiptapDoc(content)
  });
  if (result.error || !result.data) {
    return respond(args.request, result).redirect(path.to.issueWorkflows);
  }
  return respond(args.request, result).redirect(
    path.to.issueWorkflow(result.data.id),
    { message: "Non-conformance workflow created" }
  );
}

export default function NewIssueWorkflowRoute() {
  const { requiredActions } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();
  const { isPhone } = useViewport();
  const { t } = useLingui();

  // Phones show this create screen as a pushed screen: Back returns to the
  // workflow list (the route has no breadcrumb of its own).
  const appBarOverride = useMemo(
    () =>
      isPhone
        ? {
            kind: "pushed" as const,
            title: t`Issue Workflows`,
            backTo: path.to.issueWorkflows
          }
        : null,
    [isPhone, t]
  );
  useSetAppBarOverride(appBarOverride);

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
        onClose={() => closeRoute()}
      />
    </ScrollArea>
  );
}
