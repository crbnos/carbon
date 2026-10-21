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
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { RecordHeader } from "~/components/Layout/RecordHeader";
import { usePermissions } from "~/hooks";
import { parseElementFilters } from "~/modules/projects/projects.models";
import {
  getProjectElements,
  getProjectLabels,
  getProjectStates
} from "~/modules/projects/projects.service";
import { ElementRoutesProvider } from "~/modules/projects/ui/Elements/ElementRoutes";
import { getServiceTemplate } from "~/modules/service/service.service";
import { ServiceWorkList } from "~/modules/service/ui/Work/ServiceWorkList";
import { serviceTemplateElementRoutes } from "~/modules/service/ui/Work/serviceElementRoutes";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "service-template");

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Service Templates`, to: path.to.serviceTemplates },
    (data) => data?.template?.identifier ?? data?.template?.name
  )
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const template = await getServiceTemplate(client, id, companyId);
  if (template.error) {
    throw redirect(
      path.to.serviceTemplates,
      await flash(
        request,
        error(template.error, "Failed to load the service template")
      )
    );
  }

  const { filters, isFiltered } = parseElementFilters(
    new URL(request.url).searchParams
  );
  const [elements, states, labels] = await Promise.all([
    getProjectElements(client, id, companyId, filters),
    getProjectStates(client, companyId),
    getProjectLabels(client, companyId)
  ]);
  if (elements.error || states.error || labels.error) {
    logger.error("Failed to load the work of a service template", {
      companyId,
      templateId: id,
      error: elements.error ?? states.error ?? labels.error
    });
  }

  return {
    template: template.data,
    elements: elements.data ?? [],
    states: states.data ?? [],
    labels: labels.data ?? [],
    isFiltered
  };
}

/**
 * A service template: its header, then its work as the project Plan page's
 * List. An element opens on its own page; every write posts to the service
 * work routes (`x+/service-work+`).
 */
export default function ServiceTemplateRoute() {
  const { template, elements, states, labels, isFiltered } =
    useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const routes = useMemo(
    () => serviceTemplateElementRoutes(template.id),
    [template.id]
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <RecordHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            {template.identifier && (
              <span className="shrink-0 whitespace-nowrap">
                {template.identifier}
              </span>
            )}
            <span
              className={
                template.identifier
                  ? "min-w-0 truncate font-normal text-muted-foreground"
                  : "min-w-0 truncate"
              }
            >
              {template.name}
            </span>
          </span>
        }
        copyValue={template.identifier ?? undefined}
        toolsPlacement="end"
      />
      <div className="min-h-0 flex-1">
        <ElementRoutesProvider routes={routes}>
          <ServiceWorkList
            projectId={template.id}
            elements={elements}
            states={states}
            labels={labels}
            isFiltered={isFiltered}
            isDisabled={!permissions.can("update", "service")}
          />
        </ElementRoutesProvider>
      </div>
    </div>
  );
}
