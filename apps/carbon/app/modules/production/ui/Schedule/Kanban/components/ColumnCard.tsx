import {
  Card,
  CardContent,
  CardHeader,
  cn,
  IconButton,
  ScrollArea,
  ScrollBar,
} from "@carbon/react";
import { formatDurationMilliseconds } from "@carbon/utils";
import { useDndContext } from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cva } from "class-variance-authority";
import { useMemo } from "react";
import { LuGripVertical } from "react-icons/lu";
import { useUrlParams } from "~/hooks";
import type {
  Column,
  ColumnDragData,
  DisplaySettings,
  Item,
  Progress,
} from "../types";
import { ItemCard } from "./ItemCard";

type ColumnCardProps = {
  column: Column;
  items: Item[];
  isOverlay?: boolean;
  progressByItemId: Record<string, Progress>;
} & DisplaySettings;

export function ColumnCard({
  column,
  items,
  isOverlay,
  progressByItemId,
  ...displaySettings
}: ColumnCardProps) {
  const [params] = useUrlParams();
  const currentFilters = params.getAll("filter");
  const itemsIds = useMemo(() => {
    return items.map((item) => item.id);
  }, [items]);

  const totalDuration = items.reduce((acc, item) => {
    const progress = progressByItemId[item.id]?.progress ?? 0;
    const duration = item.duration ?? 0;
    const effectiveDuration = Math.max(duration - progress, 0);
    return acc + effectiveDuration;
  }, 0);

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: {
      type: "column",
      column,
    } satisfies ColumnDragData,
    attributes: {
      roleDescription: `Column: ${column.title}`,
    },
  });

  const style = {
    transition,
    transform: CSS.Translate.toString(transform),
  };

  const variants = cva(
    "w-[350px] max-w-full flex flex-col flex-shrink-0 snap-center rounded-none from-card/50 via-card/50 to-card",
    {
      variants: {
        dragging: {
          default: "border-2 border-transparent",
          over: "ring-2 opacity-30",
          overlay: "ring-2 ring-primary",
        },
      },
    }
  );

  const isActive = items.some((item) => progressByItemId[item.id]?.active);

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        `${variants({
          dragging: isOverlay ? "overlay" : isDragging ? "over" : undefined,
        })} flex flex-col p-[1px] pt-0`,
        currentFilters.length > 0
          ? "h-[calc(100dvh-135px)]"
          : "h-[calc(100dvh-98px)]"
      )}
    >
      <CardHeader className="p-4 w-full font-semibold text-left flex flex-row space-between items-center sticky top-0 bg-card z-10 border-b">
        <div className="flex flex-grow items-start space-x-2">
          {isActive && <PulsingDot />}
          <div className="flex flex-col flex-grow">
            <span className="mr-auto truncate"> {column.title}</span>
            {totalDuration > 0 ? (
              <span className="text-muted-foreground text-xs">
                {formatDurationMilliseconds(totalDuration)}
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">
                No scheduled time
              </span>
            )}
          </div>
        </div>
        <IconButton
          aria-label={`Move column: ${column.title}`}
          icon={<LuGripVertical />}
          variant={"ghost"}
          {...attributes}
          {...listeners}
          className="cursor-grab relative"
        />
      </CardHeader>
      <ScrollArea className="flex-grow">
        <CardContent className="flex flex-col gap-2 p-2">
          <SortableContext items={itemsIds}>
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={{
                  ...item,
                  status: progressByItemId[item.id]?.active
                    ? "In Progress"
                    : item.status,
                  progress: progressByItemId[item.id]?.progress ?? 0,
                }}
                {...displaySettings}
              />
            ))}
          </SortableContext>
        </CardContent>
      </ScrollArea>
    </Card>
  );
}

export function BoardContainer({ children }: { children: React.ReactNode }) {
  const dndContext = useDndContext();

  const variations = cva("px-0 flex lg:justify-center", {
    variants: {
      dragging: {
        default: "snap-x snap-mandatory",
        active: "snap-none",
      },
    },
  });

  return (
    <ScrollArea
      className={variations({
        dragging: dndContext.active ? "active" : "default",
      })}
    >
      <div className="flex gap-0 items-start flex-row justify-start p-0">
        {children}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

function PulsingDot() {
  return (
    <span className="relative flex h-2 w-2 mt-2">
      <span
        className={`absolute h-full w-full animate-ping rounded-full border border-emerald-500 opacity-100 duration-1000`}
      />
      <span className={`h-2 w-2 rounded-full bg-emerald-500`} />
    </span>
  );
}
