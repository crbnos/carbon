import { cn, IconButton, ScrollArea, ScrollBar } from "@carbon/react";
import { useUrlParams } from "@carbon/remix";
import { formatDurationMilliseconds } from "@carbon/utils";
import { useDndContext } from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cva } from "class-variance-authority";
import { useMemo } from "react";
import { LuGripVertical } from "react-icons/lu";
import type { Column, Item, Progress } from "../types";
import { ItemCard } from "./ItemCard";

type ColumnCardProps = {
  column: Column;
  items: Item[];
  isOverlay?: boolean;
  progressByItemId: Record<string, Progress>;
};

export function ColumnCard({
  column,
  items,
  isOverlay,
  progressByItemId,
}: ColumnCardProps) {
  const [params] = useUrlParams();
  const currentFilters = params.getAll("filter").filter(Boolean);
  const itemsIds = useMemo(() => {
    return items.map((item) => item.id);
  }, [items]);

  const totalDuration = items.reduce((acc, item) => {
    return acc + Math.max((item.duration ?? 0) - (item.progress ?? 0), 0);
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
    },
    attributes: {
      roleDescription: `Column: ${column.title}`,
    },
  });

  const style = {
    transition,
    transform: CSS.Translate.toString(transform),
  };

  const variants = cva(
    "w-[350px] max-w-full flex flex-col flex-shrink-0 snap-center rounded-none bg-card/30 border-0 border-r",
    {
      variants: {
        dragging: {
          default: "",
          over: "ring-2 opacity-30",
          overlay: "ring-2 ring-primary",
        },
      },
    }
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        `${variants({
          dragging: isOverlay ? "overlay" : isDragging ? "over" : undefined,
        })} flex flex-col p-[1px] pt-0`,
        currentFilters.length > 0
          ? `h-[calc(100dvh-var(--header-height)*2-var(--filters-height))]`
          : `h-[calc(100dvh-var(--header-height)*2)]`
      )}
    >
      <div className="p-4 w-full font-semibold text-left flex flex-row space-between items-center sticky top-0 bg-card z-1 border-b">
        <div className="flex flex-grow items-start space-x-2">
          {column.active ? (
            <PulsingDot />
          ) : (
            <div
              className={cn(
                "w-2 h-2 bg-muted rounded-full mt-2",
                totalDuration > 0 && "bg-red-500"
              )}
            />
          )}
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
      </div>
      <ScrollArea className="flex-grow">
        <div className="flex flex-col gap-2 p-2">
          <SortableContext items={itemsIds}>
            {items.map((item) => (
              <ItemCard
                key={item.id!}
                item={item}
                progressByItemId={progressByItemId}
              />
            ))}
          </SortableContext>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}

export function BoardContainer({ children }: { children: React.ReactNode }) {
  const dndContext = useDndContext();

  const variations = cva("relative px-0 flex lg:justify-center", {
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
