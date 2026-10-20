// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ClientOnly,
  cn,
  Input,
  InputGroup,
  InputLeftElement,
  useDebounce
} from "@carbon/react";
import type {
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent
} from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuChevronDown, LuChevronRight, LuSearch } from "react-icons/lu";
import { Link, useFetcher, useSearchParams } from "react-router";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useOptimisticLocation } from "~/hooks";
import type {
  ElementDropPlan,
  ElementDropPosition,
  ProjectElementType
} from "../../projects.models";
import {
  buildElementTree,
  elementWbsCodes,
  planElementDrop
} from "../../projects.models";
import { withChangeRequest } from "../ChangeRequests/useActiveChangeRequest";
import { useElementRoutes } from "../Elements/ElementRoutes";
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
/** The indent of one tree level: `LevelLine`'s width. */
const LEVEL_INDENT = 12;
/** The expand chevron's width, before a row's icon. */
const CHEVRON_WIDTH = 20;
/** How long a drag rests on a collapsed parent before it opens. */
const EXPAND_ON_HOVER_MS = 600;

// Module constant: a new options object makes a new sensor, and with it new
// listeners for every draggable on every render.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 6 } };

type Drop = {
  targetId: string;
  position: ElementDropPosition;
  plan: ElementDropPlan<ProjectTreeElement>;
  /** The row the preview draws on, and the line's indent level. */
  rowId: string;
  level: number;
};

/**
 * The element tree in the project sidebar, shown while a Plan page is open:
 * a search over name and readable id, then one 32 px row per element. A row
 * opens the element in the Plan page's right panel and keeps the page's
 * params (layout, filters, `?cr=`).
 *
 * The search is the Plan page's only search: it filters the tree at once and,
 * on the Plan page, writes the page's `search` param 500 ms after the last
 * key, so the Table, Tree and Reader filter on the server too.
 *
 * With `canMove`, a row drags onto another: its top quarter puts the element
 * before it, its bottom quarter after it, and its middle makes it the row's
 * last child. A line or a highlight previews the drop, and the dragged row's
 * preview names its new parent. The drop posts `intent=move` (with the new
 * sibling order) or `intent=order` to the element routes, into the open
 * change request when there is one, and the tree shows the result at once.
 * Dragging is off while the search filters the tree.
 */
export function ProjectElementTree({
  projectId,
  elements,
  canMove = false,
  className
}: {
  projectId: string;
  elements: ProjectTreeElement[];
  /** The user may move elements: the plan is editable here. */
  canMove?: boolean;
  className?: string;
}) {
  const { t } = useLingui();
  const location = useOptimisticLocation();
  const parentRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const routes = useElementRoutes(projectId);
  // On the Plan page a row keeps every param; from the element's full page
  // only the change request travels.
  const onPlanPage = location.pathname.startsWith(routes.list);
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
  // A drop shows at once; the next load of the elements replaces it.
  const [optimistic, setOptimistic] = useState<ProjectTreeElement[] | null>(
    null
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new elements list ends the optimistic one
  useEffect(() => {
    setOptimistic(null);
  }, [elements]);
  const shown = optimistic ?? elements;
  const tree = useMemo(() => buildElementTree(shown), [shown]);
  const treeById = useMemo(
    () => new Map(tree.map((node) => [node.id, node])),
    [tree]
  );
  // Codes show once the project uses a contract WBS (a pinned code).
  const wbsCodes = useMemo(
    () =>
      shown.some((element) => element.wbsCode) ? elementWbsCodes(shown) : null,
    [shown]
  );

  const {
    nodes,
    getTreeProps,
    getNodeProps,
    toggleExpandNode,
    expandNode,
    virtualizer
  } = useTree<ProjectTreeElement, { text: string }>({
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
          Boolean(wbsCodes?.[node.data.id]?.code.toLowerCase().startsWith(text))
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

  const fetcher = useFetcher();
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));
  const isDragEnabled = canMove && filterText.trim() === "";
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  // A drag ends with a click on the row it started from: it must not open it.
  const justDragged = useRef(false);

  // Resting on a collapsed parent opens it, so a drop can reach its children.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the target and position only
  useEffect(() => {
    if (!drop || drop.position !== "inside") return;
    const { targetId } = drop;
    if (!treeById.get(targetId)?.hasChildren || nodes[targetId]?.expanded) {
      return;
    }
    const timer = setTimeout(() => expandNode(targetId), EXPAND_ON_HOVER_MS);
    return () => clearTimeout(timer);
  }, [drop?.targetId, drop?.position]);

  const planDrop = (
    elementId: string,
    targetId: string,
    position: ElementDropPosition,
    rowId: string,
    level: number
  ): Drop | null => {
    const plan = planElementDrop(shown, { elementId, targetId, position });
    return plan ? { targetId, position, plan, rowId, level } : null;
  };

  /**
   * The drop for the pointer over a row. Its top quarter is "before", its
   * bottom quarter "after", its middle "inside". Below an open parent the
   * line sits above the first child, so the element lands before that child.
   * Below the last row of a subtree the pointer's indent picks the depth:
   * further left lands after an ancestor the row is the last descendant of.
   */
  const resolveDrop = (
    elementId: string,
    rowId: string,
    ratio: number,
    pointerLevel: number
  ): Drop | null => {
    const row = treeById.get(rowId);
    if (!row) return null;
    if (ratio < 0.25)
      return planDrop(elementId, rowId, "before", rowId, row.level);
    if (ratio <= 0.75) {
      return (
        planDrop(elementId, rowId, "inside", rowId, row.level) ??
        // A row that cannot take the element as a child takes it beside itself.
        planDrop(
          elementId,
          rowId,
          ratio < 0.5 ? "before" : "after",
          rowId,
          row.level
        )
      );
    }
    const firstChild = row.children[0];
    if (row.hasChildren && nodes[rowId]?.expanded && firstChild) {
      return planDrop(elementId, firstChild, "before", rowId, row.level + 1);
    }
    let target = row;
    while (target.level > pointerLevel && target.parentId) {
      const parent = treeById.get(target.parentId);
      if (!parent || parent.children.at(-1) !== target.id) break;
      target = parent;
    }
    return planDrop(elementId, target.id, "after", rowId, target.level);
  };

  const onDragStart = (event: DragStartEvent) => {
    justDragged.current = true;
    setActiveId(String(event.active.id));
  };

  const onDragMove = (event: DragMoveEvent) => {
    const { active, over, activatorEvent, delta } = event;
    if (!over || !("clientY" in activatorEvent)) {
      setDrop(null);
      return;
    }
    const pointer = activatorEvent as PointerEvent;
    const ratio =
      (pointer.clientY + delta.y - over.rect.top) / over.rect.height;
    // Fractional: a row hops up while its level is above it.
    const pointerLevel =
      (pointer.clientX + delta.x - over.rect.left - CHEVRON_WIDTH) /
      LEVEL_INDENT;
    const next = resolveDrop(
      String(active.id),
      String(over.id),
      ratio,
      pointerLevel
    );
    setDrop((previous) =>
      previous?.targetId === next?.targetId &&
      previous?.position === next?.position &&
      previous?.rowId === next?.rowId
        ? previous
        : next
    );
  };

  const endDrag = () => {
    setActiveId(null);
    setDrop(null);
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const current = drop;
    endDrag();
    if (!current) return;
    const { plan } = current;
    setOptimistic(plan.elements);
    if (plan.parentId) expandNode(plan.parentId);
    fetcher.submit(
      plan.isMove
        ? {
            intent: "move",
            elementId: String(event.active.id),
            parentId: plan.parentId ?? "",
            updates: JSON.stringify(plan.order)
          }
        : { intent: "order", updates: JSON.stringify(plan.order) },
      {
        method: "post",
        action: withChangeRequest(routes.move, changeRequestId)
      }
    );
  };

  const active = activeId ? treeById.get(activeId) : undefined;
  const newParent =
    drop?.plan.isMove && drop.plan.parentId
      ? treeById.get(drop.plan.parentId)?.data
      : undefined;

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
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={endDrag}
      >
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
            const isTarget = drop?.rowId === element.id;
            return (
              <DraggableRow
                id={element.id}
                disabled={!isDragEnabled}
                className={cn(
                  "group/node relative flex h-8 items-center rounded-md pr-2 text-sm",
                  "hover:bg-accent/60",
                  activeId === element.id && "opacity-40",
                  isTarget &&
                    drop.position === "inside" &&
                    "bg-primary/10 ring-1 ring-inset ring-primary"
                )}
              >
                {isTarget && drop.position !== "inside" && (
                  <div
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute right-0 h-0.5 rounded-full bg-primary",
                      drop.position === "before" && drop.targetId === element.id
                        ? "top-0"
                        : "bottom-0"
                    )}
                    style={{
                      left: drop.level * LEVEL_INDENT + CHEVRON_WIDTH
                    }}
                  />
                )}
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
                  to={`${routes.element(element.id)}${search}`}
                  title={`${element.readableId} ${element.name}`}
                  draggable={false}
                  onClick={(event) => {
                    if (justDragged.current) event.preventDefault();
                  }}
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
              </DraggableRow>
            );
          }}
        />
        <ClientOnly fallback={null}>
          {() =>
            createPortal(
              <DragOverlay dropAnimation={null}>
                {active && (
                  <div className="flex w-64 flex-col gap-0.5 rounded-md border border-border bg-popover px-2 py-1.5 text-sm shadow-md">
                    <div className="flex min-w-0 items-center gap-2">
                      <ElementTypeIcon
                        type={active.data.type}
                        className="size-3.5"
                      />
                      <span className="truncate">{active.data.name}</span>
                    </div>
                    {drop?.plan.isMove && (
                      <span className="truncate text-xs text-muted-foreground">
                        {newParent ? (
                          <Trans>Into {newParent.name}</Trans>
                        ) : (
                          <Trans>To the top level</Trans>
                        )}
                      </span>
                    )}
                  </div>
                )}
              </DragOverlay>,
              document.body
            )
          }
        </ClientOnly>
      </DndContext>
    </div>
  );
}

/**
 * A tree row that drags and takes drops. Only the pointer listeners are
 * spread: the tree item around it keeps its own role and focus.
 */
function DraggableRow({
  id,
  disabled,
  className,
  children
}: {
  id: string;
  disabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef: setDragRef, listeners } = useDraggable({
    id,
    disabled
  });
  const { setNodeRef: setDropRef } = useDroppable({ id, disabled });
  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      {...listeners}
      className={className}
    >
      {children}
    </div>
  );
}
