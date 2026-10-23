// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { elementEarnedValueValidator } from "@carbon/ee/project-control";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import {
  type ActionFunctionArgs,
  data,
  type LoaderFunctionArgs,
  useLoaderData,
  useParams
} from "react-router";
import { useRouteData } from "~/hooks";
import { getProjectElementPageInChangeRequest } from "~/modules/projects/projects.service";
import type {
  Project,
  ProjectLabel,
  ProjectMilestone,
  ProjectState
} from "~/modules/projects/types";
import ChangeRequestBanner from "~/modules/projects/ui/ChangeRequests/ChangeRequestBanner";
import { ElementView } from "~/modules/projects/ui/Element/ElementView";
import { getRecordIssueLinks } from "~/modules/shared/shared.service";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-element");

export const handle: Handle = {
  breadcrumb: (
    _params: unknown,
    data: { element?: { readableId?: string } } | undefined
  ) => data?.element?.readableId
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "projects"
  });

  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  // `?cr=` shows the element as an open change request would leave it.
  const page = await getProjectElementPageInChangeRequest(
    client,
    getDatabaseClient(),
    {
      companyId,
      projectId,
      elementId,
      userId,
      changeRequestId: new URL(request.url).searchParams.get("cr")
    }
  );
  if (page.error || !page.data) {
    logger.error("Failed to load project element", {
      companyId,
      projectId,
      elementId,
      error: page.error
    });
    throw redirect(
      path.to.projectElements(projectId),
      await flash(request, error(page.error, "Failed to load the element"))
    );
  }

  // The element's Linear and Jira links (issue-sync), for the issue dialogs.
  return {
    ...page.data,
    ...(await getRecordIssueLinks(
      client,
      "projectElement",
      elementId,
      companyId
    ))
  };
}

/**
 * Saves the earned value fields of the element (intent `earned-value`,
 * Government Contracting 5c). Commercial: `requireFeature` is the upgrade
 * redirect; `requireEntitlement` in the ee function is the lock. A refusal
 * (no control account above, not chargeable) comes back as a field error.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "projects"
  });
  const { projectId, elementId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  if (!elementId) throw new Error("Could not find elementId");

  const formData = await request.formData();
  if (formData.get("intent") !== "earned-value") {
    return data(
      { success: false },
      await flash(request, error(null, "Unknown action"))
    );
  }

  await requireFeature({
    request,
    client,
    companyId,
    feature: "GOVERNMENT_CONTRACTING",
    redirectTo: path.to.projectElement(projectId, elementId)
  });

  formData.set("elementId", elementId);
  const validation = await validator(elementEarnedValueValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const api = await carbon(request);
  const result = await api.projects.updateProjectElementEarnedValue({
    ...validation.data,
    projectId
  });
  if (result.error) {
    // A refusal of the fields shows on the field it is about.
    if (result.error.category === "validation") {
      return validationError({
        fieldErrors: {
          [validation.data.isControlAccount
            ? "isControlAccount"
            : "earnedValueTechnique"]: result.error.message
        }
      });
    }
    return data(
      { success: false },
      await flash(request, error(null, result.error.message))
    );
  }

  return data(
    { success: true },
    await flash(request, success("Earned value saved"))
  );
}

/** The element as a full page inside the project. */
export default function ProjectElementRoute() {
  const { projectId } = useParams();
  if (!projectId) throw new Error("Could not find projectId");

  const page = useLoaderData<typeof loader>();
  const routeData = useRouteData<{
    project: Project;
    states: ProjectState[];
    labels: ProjectLabel[];
    milestones: ProjectMilestone[];
  }>(path.to.project(projectId));

  return (
    <div className="flex h-full flex-col">
      {page.changeRequest && (
        <ChangeRequestBanner
          projectId={projectId}
          changeRequest={page.changeRequest}
        />
      )}
      <div className="min-h-0 flex-1">
        <ElementView
          {...page}
          projectId={projectId}
          project={routeData?.project}
          states={routeData?.states ?? []}
          labels={routeData?.labels ?? []}
          milestones={routeData?.milestones ?? []}
        />
      </div>
    </div>
  );
}
