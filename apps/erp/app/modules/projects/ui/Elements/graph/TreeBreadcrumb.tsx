// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useSearchParams } from "react-router";
import { BreadcrumbItem, BreadcrumbLink, Breadcrumbs } from "~/components";
import { ElementTypeIcon } from "../ElementTypeIcon";
import type { TreeElement } from "./tree-layout";

/**
 * The path to the Tree layout's root: the project, the root's ancestors and
 * the root. Each crumb sets `?root=` to its element; the project crumb clears
 * it.
 */
export function TreeBreadcrumb({
  projectName,
  path
}: {
  projectName: string;
  path: TreeElement[];
}) {
  const [searchParams] = useSearchParams();
  const toRoot = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("root", id);
    else next.delete("root");
    return `?${next}`;
  };

  return (
    <Breadcrumbs>
      <BreadcrumbItem>
        <BreadcrumbLink
          to={toRoot(null)}
          isCurrentPage={path.length === 0}
          className="h-7 max-w-48 gap-1.5 px-1.5 text-sm"
        >
          <span className="truncate">{projectName}</span>
        </BreadcrumbLink>
      </BreadcrumbItem>
      {path.map((element, index) => (
        <BreadcrumbItem key={element.id}>
          <BreadcrumbLink
            to={toRoot(element.id)}
            isCurrentPage={index === path.length - 1}
            className="h-7 max-w-48 gap-1.5 px-1.5 text-sm"
          >
            <ElementTypeIcon type={element.type} className="size-3.5" />
            <span className="truncate">{element.name}</span>
          </BreadcrumbLink>
        </BreadcrumbItem>
      ))}
    </Breadcrumbs>
  );
}
