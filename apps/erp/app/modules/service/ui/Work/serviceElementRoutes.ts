// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ElementRoutes } from "~/modules/projects/ui/Elements/ElementRoutes";
import { path } from "~/utils/path";
import { serviceNodeTypes } from "../../service.models";

/** The service work routes of a Service project, under `service` permissions. */
function serviceWorkRoutes(
  projectId: string
): Omit<ElementRoutes, "list" | "element"> {
  return {
    module: "service",
    types: serviceNodeTypes,
    create: path.to.serviceWorkNew(projectId),
    update: path.to.serviceWorkUpdate(projectId),
    move: path.to.serviceWorkMove(projectId),
    remove: (elementId) => path.to.serviceWorkDelete(projectId, elementId),
    comments: (elementId) => path.to.serviceWorkComments(projectId, elementId),
    plan: (elementId) => path.to.serviceWorkPlan(projectId, elementId)
  };
}

/** A service order's work: its Work tab and its element pages. */
export function serviceOrderElementRoutes(
  serviceOrderId: string,
  projectId: string
): ElementRoutes {
  return {
    ...serviceWorkRoutes(projectId),
    list: path.to.serviceOrderWork(serviceOrderId),
    element: (elementId) =>
      path.to.serviceOrderWorkNode(serviceOrderId, elementId)
  };
}

/** A service template's work: the template page and its element pages. */
export function serviceTemplateElementRoutes(
  templateId: string
): ElementRoutes {
  return {
    ...serviceWorkRoutes(templateId),
    list: path.to.serviceTemplate(templateId),
    element: (elementId) => path.to.serviceTemplateNode(templateId, elementId)
  };
}
