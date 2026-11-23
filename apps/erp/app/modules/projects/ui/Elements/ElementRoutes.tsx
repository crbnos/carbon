// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { path } from "~/utils/path";
import type { ProjectElementType } from "../../projects.models";
import { projectElementTypes } from "../../projects.models";

/**
 * Where the element list and the element page link and post. A project's
 * elements use the project routes; a service order's and a service template's
 * use the service work routes, under the service permissions. The pages are
 * the same components either way.
 */
export type ElementRoutes = {
  /** The permission module the routes check. */
  module: "projects" | "service";
  /** The element types a user may add. */
  types: readonly ProjectElementType[];
  /** The list the elements come from: the Plan page, or the Work tab. */
  list: string;
  /** An element's own page. */
  element: (elementId: string) => string;
  create: string;
  /** One field of one or more elements: `{ ids, field, value }`. */
  update: string;
  /** `intent=move` or `intent=order`. */
  move: string;
  remove: (elementId: string) => string;
  comments: (elementId: string) => string;
  plan: (elementId: string) => string;
};

export function projectElementRoutes(projectId: string): ElementRoutes {
  return {
    module: "projects",
    types: projectElementTypes,
    list: path.to.projectElements(projectId),
    element: (elementId) => path.to.projectElement(projectId, elementId),
    create: path.to.newProjectElement(projectId),
    update: path.to.projectElementUpdate(projectId),
    move: path.to.projectElementMove(projectId),
    remove: (elementId) => path.to.deleteProjectElement(projectId, elementId),
    comments: (elementId) =>
      path.to.projectElementComments(projectId, elementId),
    plan: (elementId) => path.to.projectElementPlan(projectId, elementId)
  };
}

const ElementRoutesContext = createContext<ElementRoutes | null>(null);

export function ElementRoutesProvider({
  routes,
  children
}: {
  routes: ElementRoutes;
  children: ReactNode;
}) {
  return (
    <ElementRoutesContext.Provider value={routes}>
      {children}
    </ElementRoutesContext.Provider>
  );
}

/** The routes in effect: the provider's, else the project's own. */
export function useElementRoutes(projectId: string): ElementRoutes {
  return useContext(ElementRoutesContext) ?? projectElementRoutes(projectId);
}
