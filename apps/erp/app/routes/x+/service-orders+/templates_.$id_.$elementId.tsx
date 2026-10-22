// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useMemo } from "react";
import {
  type LoaderFunctionArgs,
  useLoaderData,
  useParams
} from "react-router";
import {
  getProject,
  getProjectElementPage,
  getProjectLabels,
  getProjectStates
} from "~/modules/projects/projects.service";
import { ElementView } from "~/modules/projects/ui/Element/ElementView";
import { ElementRoutesProvider } from "~/modules/projects/ui/Elements/ElementRoutes";
import { serviceTemplateElementRoutes } from "~/modules/service/ui/Work/serviceElementRoutes";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "service-template-element");

export const handle: Handle = {
  breadcrumb: (
    params: { id?: string },
    data?: {
      project?: { identifier: string | null; name: string };
      element?: { readableId: string };
    }
  ) => [
    { breadcrumb: msg`Service Templates`, to: path.to.serviceTemplates },
    ...(data?.project && params.id
      ? [
          {
            breadcrumb: data.project.identifier ?? data.project.name,
            to: path.to.serviceTemplate(params.id)
          }
        ]
      : []),
    ...(data?.element ? [{ breadcrumb: data.element.readableId }] : [])
  ],
  module: "service"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "service"
  });
  const { id, elementId } = params;
  if (!id) throw new Error("Could not find id");
  if (!elementId) throw new Error("Could not find elementId");

  const [page, project, states, labels] = await Promise.all([
    getProjectElementPage(client, getDatabaseClient(), {
      companyId,
      projectId: id,
      elementId,
      userId
    }),
    getProject(client, companyId, id),
    getProjectStates(client, companyId),
    getProjectLabels(client, companyId)
  ]);
  if (
    page.error ||
    !page.data ||
    project.error ||
    !project.data?.isTemplate ||
    project.data.projectType !== "Service"
  ) {
    logger.error("Failed to load a service template element", {
      companyId,
      templateId: id,
      elementId,
      error: page.error ?? project.error
    });
    throw redirect(
      path.to.serviceTemplate(id),
      await flash(
        request,
        error(page.error ?? project.error, "Failed to load the element")
      )
    );
  }

  return {
    ...page.data,
    project: project.data,
    states: states.data ?? [],
    labels: labels.data ?? []
  };
}

/**
 * A service template's element as a full page: the project element page,
 * without charges (a template takes none). Its plan lines are what a
 * service order started from the template copies.
 */
export default function ServiceTemplateElementRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const { project, states, labels, ...page } = useLoaderData<typeof loader>();
  const routes = useMemo(() => serviceTemplateElementRoutes(id), [id]);

  return (
    <ElementRoutesProvider routes={routes}>
      <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] w-full flex-col">
        <ElementView
          key={page.element.id}
          {...page}
          projectId={id}
          project={project}
          states={states}
          labels={labels}
          milestones={[]}
          chargeActions={null}
          charges={null}
        />
      </div>
    </ElementRoutesProvider>
  );
}
