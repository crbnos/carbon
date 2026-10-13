// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cn,
  Input,
  InputGroup,
  InputLeftElement,
  useDebounce
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuChevronDown, LuChevronRight, LuSearch } from "react-icons/lu";
import { Link, useSearchParams } from "react-router";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useOptimisticLocation } from "~/hooks";
import { path } from "~/utils/path";
import type { ProjectElementType } from "../../projects.models";
import { buildElementTree, elementWbsCodes } from "../../projects.models";
import { ElementTypeIcon } from "../Elements/ElementTypeIcon";
import { WbsCode } from "../Elements/WbsCode";

export type ProjectTreeElement = {
  id: string;
  parentId: string | null;
  sortOrder: number;
  readableId: string;
  name: string;
  type: ProjectElementType;
  sequence: number;
  /** The pinned WBS code, or null to derive it. */
  wbsCode: string | null;
};

const ROW_HEIGHT = 32;

/**
 * The element tree in the project sidebar, shown while a Plan page is open:
 * a search over name and readable id, then one 32 px row per element. A row
 * opens the element in the Plan page's right panel and keeps the page's
 * params (layout, filters, `?cr=`).
 *
 * The search is the Plan page's only search: it filters the tree at once and,
 * on the Plan page, writes the page's `search` param 500 ms after the last
 * key, so the Table, Tree and Reader filter on the server too.
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
  const location = useOptimisticLocation();
  const parentRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // On the Plan page a row keeps every param; from the element's full page
  // only the change request travels.
  const onPlanPage = location.pathname.startsWith(
    path.to.projectElements(projectId)
  );
  const urlSearch = onPlanPage ? (searchParams.get("search") ?? "") : "";
  const [filterText, setFilterText] = useState(urlSearch);
  // What this box last wrote to the URL. A different value there came from
  // elsewhere (back/forward, a link) and replaces the text; our own write
  // arriving late must not undo what was typed since.
  const written = useRef(urlSearch);
  const writeSearch = useDebounce((text: string) => {
    written.current = text.trim();
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (text.trim()) next.set("search", text.trim());
        else next.delete("search");
        return next;
      },
      { replace: true, preventScrollReset: true }
    );
  }, 500);
  useEffect(() => {
    if (onPlanPage && urlSearch !== written.current) {
      written.current = urlSearch;
      setFilterText(urlSearch);
    }
  }, [urlSearch, onPlanPage]);
  const tree = useMemo(() => buildElementTree(elements), [elements]);
  // Codes show once the project uses a contract WBS (a pinned code).
  const wbsCodes = useMemo(
    () =>
      elements.some((element) => element.wbsCode)
        ? elementWbsCodes(elements)
        : null,
    [elements]
  );

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
            node.data.readableId.toLowerCase().includes(text) ||
            Boolean(wbsCodes?.[node.data.id]?.code.startsWith(text))
          );
        }
      },
      isEager: true
    });

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
          onChange={(event) => {
            setFilterText(event.target.value);
            if (onPlanPage) writeSearch(event.target.value);
          }}
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
          return (
            <div
              className={cn(
                "group/node flex h-8 items-center rounded-md pr-2 text-sm",
                "hover:bg-accent/60"
              )}
            >
              {Array.from({ length: node.level }).map((_, index) => (
                <LevelLine key={index} isSelected={false} className="h-8" />
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
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <ElementTypeIcon type={element.type} className="size-3.5" />
                {wbsCodes?.[element.id] && (
                  <WbsCode wbs={wbsCodes[element.id]!} />
                )}
                <span className="truncate text-foreground/80">
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
