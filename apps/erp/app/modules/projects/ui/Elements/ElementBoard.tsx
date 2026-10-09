// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ClientOnly, cn } from "@carbon/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Trans } from "@lingui/react/macro";
import type { RefObject } from "react";
import { memo, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Link,
  useFetchers,
  useLocation,
  useNavigate,
  useParams,
  useSubmit
} from "react-router";
import { path } from "~/utils/path";
import type { ProjectElementType } from "../../projects.models";
import type { ProjectElementListItem } from "../../projects.service";
import type { ProjectLabel, ProjectMilestone, ProjectState } from "../../types";
import {
  useActiveChangeRequestId,
  withChangeRequest
} from "../ChangeRequests/useActiveChangeRequest";
import { StateIcon } from "../Project/StateIcon";
import type { ElementLayoutProps } from "./ElementList";
import { QuickAddRow } from "./ElementList";
import type { ElementDisplay } from "./ElementProperties";
import {
  ElementProperties,
  elementFieldKey,
  sortStates
} from "./ElementProperties";
import { ElementTypeIcon } from "./ElementTypeIcon";

// Module constants: a new options object makes a new sensor, and new
// listeners for every card on every render (see the schedule boards). There
// is no keyboard sensor: a card holds pills and a link, and Enter on them
// would start a drag. A keyboard user changes the state on the element page.
const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 6 } };
const TOUCH_SENSOR_OPTIONS = {
  activationConstraint: { delay: 200, tolerance: 6 }
};
const NO_ELEMENTS: ProjectElementListItem[] = [];

type ElementBoardProps = ElementLayoutProps & {
  newType: ProjectElementType;
  onNewTypeChange: (type: ProjectElementType) => void;
  quickAddRef: RefObject<HTMLInputElement>;
};

/** The state each element shows in, with a pending drag or pill save applied. */
function usePendingStates() {
  const fetchers = useFetchers();
  const pending = new Map<string, string>();
  for (const fetcher of fetchers) {
    if (!fetcher.formData || fetcher.formData.get("field") !== "stateId") {
      continue;
    }
    const value = fetcher.formData.get("value");
    if (typeof value !== "string" || !value) continue;
    for (const id of fetcher.formData.getAll("ids")) {
      if (typeof id === "string") pending.set(id, value);
    }
  }
  return pending;
}

export function ElementBoard({
  projectId,
  identifier,
  elements,
  states,
  labels,
  milestones,
  display,
  actualByElement,
  canUpdate,
  canCreate,
  newType,
  onNewTypeChange,
  quickAddRef
}: ElementBoardProps) {
  const submit = useSubmit();
  const changeRequestId = useActiveChangeRequestId();
  const pendingStates = usePendingStates();
  const [active, setActive] = useState<ProjectElementListItem | null>(null);

  const columns = useMemo(() => sortStates(states), [states]);
  const elementsByState = useMemo(() => {
    const byState = new Map<string, ProjectElementListItem[]>();
    for (const element of elements) {
      const stateId = pendingStates.get(element.id) ?? element.stateId;
      const list = byState.get(stateId) ?? [];
      list.push(element);
      byState.set(stateId, list);
    }
    return byState;
  }, [elements, pendingStates]);

  // The first quick-add row takes **+ New**: the default Unstarted state.
  const newColumnId =
    columns.find((s) => s.group === "Unstarted" && s.isDefault)?.id ??
    columns.find((s) => s.group === "Unstarted")?.id ??
    columns[0]?.id;

  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS)
  );

  const onDragStart = ({ active }: DragStartEvent) => {
    setActive(
      (active.data.current?.element as ProjectElementListItem | undefined) ??
        null
    );
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActive(null);
    const element = active.data.current?.element as
      | ProjectElementListItem
      | undefined;
    if (!element || !over) return;
    const stateId = String(over.id);
    const current = pendingStates.get(element.id) ?? element.stateId;
    if (stateId === current) return;
    submit(
      { ids: element.id, field: "stateId", value: stateId },
      {
        method: "post",
        action: withChangeRequest(
          path.to.projectElementUpdate(projectId),
          changeRequestId
        ),
        navigate: false,
        fetcherKey: elementFieldKey(element.id, "stateId")
      }
    );
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="flex h-full min-h-0 gap-3 overflow-x-auto p-3">
        {columns.map((state) => (
          <BoardColumn
            key={state.id}
            projectId={projectId}
            identifier={identifier}
            state={state}
            elements={elementsByState.get(state.id) ?? NO_ELEMENTS}
            states={states}
            labels={labels}
            milestones={milestones}
            display={display}
            actualByElement={actualByElement}
            canUpdate={canUpdate}
            canCreate={canCreate}
            newType={newType}
            onNewTypeChange={onNewTypeChange}
            quickAddRef={state.id === newColumnId ? quickAddRef : undefined}
          />
        ))}
      </div>
      <ClientOnly fallback={null}>
        {() =>
          createPortal(
            <DragOverlay>
              {active && (
                <ElementCardBody
                  projectId={projectId}
                  element={active}
                  states={states}
                  labels={labels}
                  milestones={milestones}
                  display={display}
                  actual={actualByElement.get(active.id) ?? 0}
                  isDisabled
                  isOverlay
                />
              )}
            </DragOverlay>,
            document.body
          )
        }
      </ClientOnly>
    </DndContext>
  );
}

function BoardColumn({
  projectId,
  identifier,
  state,
  elements,
  states,
  labels,
  milestones,
  display,
  actualByElement,
  canUpdate,
  canCreate,
  newType,
  onNewTypeChange,
  quickAddRef
}: {
  projectId: string;
  identifier: string;
  state: ProjectState;
  elements: ProjectElementListItem[];
  states: ProjectState[];
  labels: ProjectLabel[];
  milestones: ProjectMilestone[];
  display: ElementDisplay;
  actualByElement: Map<string, number>;
  canUpdate: boolean;
  canCreate: boolean;
  newType: ProjectElementType;
  onNewTypeChange: (type: ProjectElementType) => void;
  quickAddRef?: RefObject<HTMLInputElement>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: state.id });
  // The column header shows the state, so the cards leave the state pill out.
  const cardDisplay = useMemo(() => ({ ...display, state: false }), [display]);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/30 transition-colors",
        isOver && "border-primary/60 bg-accent/40"
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <StateIcon group={state.group} color={state.color} />
        <span className="truncate text-sm font-medium">{state.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {elements.length}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {elements.map((element) => (
          <DraggableCard
            key={element.id}
            projectId={projectId}
            element={element}
            states={states}
            labels={labels}
            milestones={milestones}
            display={cardDisplay}
            actual={actualByElement.get(element.id) ?? 0}
            canUpdate={canUpdate}
          />
        ))}
        {elements.length === 0 && (
          <div className="flex items-center justify-center rounded-md border border-dashed border-border py-6 text-xs text-muted-foreground">
            <Trans>No elements</Trans>
          </div>
        )}
      </div>
      {canCreate && (
        <QuickAddRow
          projectId={projectId}
          identifier={identifier}
          type={newType}
          onTypeChange={onNewTypeChange}
          stateId={state.id}
          inputRef={quickAddRef}
          className="rounded-b-lg"
        />
      )}
    </div>
  );
}

/** A thin shell that calls `useDraggable`; the body is memoized. */
function DraggableCard({
  projectId,
  element,
  states,
  labels,
  milestones,
  display,
  actual,
  canUpdate
}: {
  projectId: string;
  element: ProjectElementListItem;
  states: ProjectState[];
  labels: ProjectLabel[];
  milestones: ProjectMilestone[];
  display: ElementDisplay;
  actual: number;
  canUpdate: boolean;
}) {
  const { setNodeRef, listeners, transform, isDragging } = useDraggable({
    id: element.id,
    data: { element },
    disabled: !canUpdate
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("touch-manipulation", isDragging && "opacity-40")}
      {...listeners}
    >
      <ElementCardBody
        projectId={projectId}
        element={element}
        states={states}
        labels={labels}
        milestones={milestones}
        display={display}
        actual={actual}
        isDisabled={!canUpdate}
      />
    </div>
  );
}

const ElementCardBody = memo(function ElementCardBody({
  projectId,
  element,
  states,
  labels,
  milestones,
  display,
  actual,
  isDisabled,
  isOverlay
}: {
  projectId: string;
  element: ProjectElementListItem;
  states: ProjectState[];
  labels: ProjectLabel[];
  milestones: ProjectMilestone[];
  display: ElementDisplay;
  actual: number;
  isDisabled: boolean;
  isOverlay?: boolean;
}) {
  const navigate = useNavigate();
  const { elementId: openElementId } = useParams();
  // Opening an element keeps the layout and filters in the URL.
  const { search } = useLocation();
  const to = `${path.to.projectElement(projectId, element.id)}${search}`;

  return (
    <div
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-md border border-border bg-card p-2.5 text-sm transition-colors hover:bg-accent/40",
        element.id === openElementId && "border-primary/60",
        isOverlay && "w-[17rem] shadow-lg ring-1 ring-primary/40"
      )}
      onClick={() => navigate(to)}
    >
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
          {element.readableId}
        </span>
        <ElementTypeIcon type={element.type} className="size-3.5" />
      </div>
      <Link
        to={to}
        className="line-clamp-2 font-medium"
        onClick={(event) => event.stopPropagation()}
      >
        {element.name}
      </Link>
      <ElementProperties
        projectId={projectId}
        element={element}
        display={display}
        states={states}
        labels={labels}
        milestones={milestones}
        actual={actual}
        isDisabled={isDisabled}
      />
    </div>
  );
});
