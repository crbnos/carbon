// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { TruncatedTooltipText } from "@carbon/react";
import { useSearchParams } from "react-router";
import { BreadcrumbItem, BreadcrumbLink, Breadcrumbs } from "~/components";
import { ElementTypeIcon } from "../ElementTypeIcon";
import type { TreeElement } from "./tree-layout";

/**
 * The path to the Tree layout's root: the project, the root's ancestors and
 * the root. Each crumb sets `?root=` to its element; the project crumb clears
 * it. The crumbs take the toolbar's free width and truncate only when it
 * runs out; a truncated name shows in full in a tooltip.
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
    <Breadcrumbs className="min-w-0 [&>ol]:min-w-0">
      <BreadcrumbItem className={itemClassName}>
        <BreadcrumbLink
          to={toRoot(null)}
          isCurrentPage={path.length === 0}
          className={linkClassName}
        >
          <TruncatedTooltipText tooltip={projectName} className="truncate">
            {projectName}
          </TruncatedTooltipText>
        </BreadcrumbLink>
      </BreadcrumbItem>
      {path.map((element, index) => (
        <BreadcrumbItem key={element.id} className={itemClassName}>
          <BreadcrumbLink
            to={toRoot(element.id)}
            isCurrentPage={index === path.length - 1}
            className={linkClassName}
          >
            <ElementTypeIcon
              type={element.type}
              className="size-3.5 shrink-0"
            />
            <TruncatedTooltipText tooltip={element.name} className="truncate">
              {element.name}
            </TruncatedTooltipText>
          </BreadcrumbLink>
        </BreadcrumbItem>
      ))}
    </Breadcrumbs>
  );
}

/** A crumb may shrink below its name (the "/" cannot shrink). */
const itemClassName = "min-w-0";
const linkClassName = "h-7 min-w-0 shrink gap-1.5 px-1.5 text-sm";
