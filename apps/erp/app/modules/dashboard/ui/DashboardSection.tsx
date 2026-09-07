import { Button, Card, CardContent, cn } from "@carbon/react";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trans } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { LuPlus } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Empty } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type {
  DashboardLayoutRow,
  DashboardRange,
  ResolvedWidget,
  WidgetSize
} from "../dashboard.models";
import { resolveDashboardLayout } from "../dashboard.models";
import { DashboardCatalogDrawer } from "./DashboardCatalogDrawer";
import { DashboardRangeSelect } from "./DashboardRangeSelect";
import { DashboardWidget } from "./DashboardWidget";

const SIZE_CLASS: Record<WidgetSize, string> = {
  sm: "",
  md: "lg:col-span-2",
  lg: "lg:col-span-3"
};

/**
 * The analytics area at the bottom of the home page: page-wide range select,
 * an "Add widgets" button that opens the show/hide catalog, and the visible
 * widgets on the same 3-column grid the rest of the page uses. Cards are
 * dragged by their grip to reorder; the new order is saved immediately.
 */
export function DashboardSection({
  rows,
  order,
  range,
  today
}: {
  rows: DashboardLayoutRow[];
  /** Saved widget keys in display order; empty = registry order. */
  order: string[];
  range: DashboardRange;
  today: string;
}) {
  const permissions = usePermissions();
  const [editing, setEditing] = useState(false);
  const orderFetcher = useFetcher();

  const resolved = useMemo(
    () => resolveDashboardLayout(permissions.can, rows, order),
    [permissions.can, rows, order]
  );

  // The order the grid renders: the server's until the user drags, then the
  // dragged order until the loader revalidates with it saved. Resetting on a
  // server change keeps a save from another tab from being overwritten.
  const [widgets, setWidgets] = useState<ResolvedWidget[]>(resolved);
  useEffect(() => {
    setWidgets(resolved);
  }, [resolved]);

  const visible = widgets.filter((w) => w.visible);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    // Move within the FULL list (hidden widgets keep their slots) so the
    // saved order is the complete key list the resolver expects.
    const from = widgets.findIndex((w) => w.key === active.id);
    const to = widgets.findIndex((w) => w.key === over.id);
    if (from === -1 || to === -1) return;
    const next = arrayMove(widgets, from, to);
    setWidgets(next);
    orderFetcher.submit(JSON.stringify({ order: next.map((w) => w.key) }), {
      method: "post",
      action: path.to.api.dashboardPreference,
      encType: "application/json"
    });
  };

  // Nothing the user may view → no section, no controls.
  if (widgets.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-base font-medium tracking-tight flex-1">
          <Trans>Analytics</Trans>
        </h2>
        <DashboardRangeSelect value={range} />
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<LuPlus />}
          onClick={() => setEditing(true)}
        >
          <Trans>Add widgets</Trans>
        </Button>
      </div>
      {visible.length === 0 ? (
        <Card className="shadow-none">
          <CardContent className="py-8">
            <Empty>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Trans>Add widgets</Trans>
              </Button>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visible.map((w) => w.key)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {visible.map((widget) => (
                <SortableWidget
                  key={widget.key}
                  widget={widget}
                  pageRange={range}
                  today={today}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <DashboardCatalogDrawer
        open={editing}
        onClose={() => setEditing(false)}
        widgets={widgets}
      />
    </div>
  );
}

function SortableWidget({
  widget,
  pageRange,
  today
}: {
  widget: ResolvedWidget;
  pageRange: DashboardRange;
  today: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: widget.key });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? undefined
      }}
      className={cn(
        SIZE_CLASS[widget.size],
        "transition-opacity duration-150",
        isDragging && "z-10 opacity-60"
      )}
    >
      <DashboardWidget
        widget={widget}
        pageRange={pageRange}
        today={today}
        dragHandle={{ ref: setActivatorNodeRef, attributes, listeners }}
      />
    </div>
  );
}
