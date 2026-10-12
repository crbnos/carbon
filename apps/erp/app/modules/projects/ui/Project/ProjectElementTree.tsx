// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, Input, InputGroup, InputLeftElement } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import { LuChevronDown, LuChevronRight, LuSearch } from "react-icons/lu";
import { Link, useParams } from "react-router";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useOptimisticLocation } from "~/hooks";
import { path } from "~/utils/path";
import type { ProjectElementType } from "../../projects.models";
import { buildElementTree } from "../../projects.models";
import { ElementTypeIcon } from "../Elements/ElementTypeIcon";

export type ProjectTreeElement = {
  id: string;
  parentId: string | null;
  sortOrder: number;
  readableId: string;
  name: string;
  type: ProjectElementType;
};

const ROW_HEIGHT = 32;

/**
 * The element tree in the project sidebar, shown while a Plan page is open:
 * a search over name and readable id, then one 32 px row per element. A row
 * opens the element in the Plan page's right panel and keeps the page's
 * params (layout, filters, `?cr=`).
 */
export function ProjectElementTree({
  projectId,
  elements,
  className
}: {
  projectId: string;
  elements: ProjectTreeElement[];
  className?: string;
}) {
  const { t } = useLingui();
  const { elementId: openElementId } = useParams();
  const location = useOptimisticLocation();
  const parentRef = useRef<HTMLDivElement>(null);
  const [filterText, setFilterText] = useState("");
  const tree = useMemo(() => buildElementTree(elements), [elements]);

  const { nodes, getTreeProps, getNodeProps, toggleExpandNode, virtualizer } =
    useTree<ProjectTreeElement, { text: string }>({
      tree,
      parentRef,
      estimatedRowHeight: () => ROW_HEIGHT,
      filter: {
        value: { text: filterText },
        fn: (value, node) => {
          if (value.text === "") return true;
          const text = value.text.toLowerCase();
          return (
            node.data.name.toLowerCase().includes(text) ||
            node.data.readableId.toLowerCase().includes(text)
          );
        }
      },
      isEager: true
    });

  // On the Plan page a row keeps every param; from the element's full page
  // only the change request travels.
  const onPlanPage = location.pathname.startsWith(
    path.to.projectElements(projectId)
  );
  const changeRequestId = new URLSearchParams(location.search).get("cr");
  const search = onPlanPage
    ? location.search
    : changeRequestId
      ? `?cr=${encodeURIComponent(changeRequestId)}`
      : "";

  return (
    <div className={cn("flex min-h-0 flex-col gap-1", className)}>
      <InputGroup size="sm" className="shrink-0">
        <InputLeftElement>
          <LuSearch className="size-4 text-muted-foreground" />
        </InputLeftElement>
        <Input
          placeholder={t`Search elements`}
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
        />
      </InputGroup>
      <TreeView<ProjectTreeElement>
        tree={tree}
        nodes={nodes}
        getTreeProps={getTreeProps}
        getNodeProps={getNodeProps}
        virtualizer={virtualizer}
        parentRef={parentRef}
        parentClassName="min-h-0 flex-1"
        renderNode={({ node, state }) => {
          const element = node.data;
          const isOpen = element.id === openElementId;
          return (
            <div
              className={cn(
                "group/node flex h-8 items-center rounded-md pr-2 text-sm",
                isOpen ? "bg-accent" : "hover:bg-accent/60"
              )}
            >
              {Array.from({ length: node.level }).map((_, index) => (
                <LevelLine key={index} isSelected={isOpen} className="h-8" />
              ))}
              <button
                type="button"
                tabIndex={-1}
                aria-label={
                  state.expanded
                    ? t`Collapse ${element.readableId}`
                    : t`Expand ${element.readableId}`
                }
                disabled={!node.hasChildren}
                className="flex h-8 w-5 shrink-0 items-center justify-center text-muted-foreground"
                onClick={() => toggleExpandNode(node.id)}
              >
                {node.hasChildren &&
                  (state.expanded ? (
                    <LuChevronDown className="size-3.5" />
                  ) : (
                    <LuChevronRight className="size-3.5" />
                  ))}
              </button>
              <Link
                to={`${path.to.projectElement(projectId, element.id)}${search}`}
                title={`${element.readableId} ${element.name}`}
                aria-current={isOpen ? "page" : undefined}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <ElementTypeIcon type={element.type} className="size-3.5" />
                <span
                  className={cn(
                    "truncate",
                    isOpen ? "text-foreground" : "text-foreground/80"
                  )}
                >
                  {element.name}
                </span>
              </Link>
            </div>
          );
        }}
      />
    </div>
  );
}
