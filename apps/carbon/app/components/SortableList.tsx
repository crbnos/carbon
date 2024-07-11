"use client";

import { LayoutGroup, Reorder, useDragControls } from "framer-motion";
import type { ReactNode } from "react";
import { useState } from "react";

import { Checkbox, HStack, cn } from "@carbon/react";
import { LuTrash } from "react-icons/lu";

export interface Item {
  checked: boolean;
  details?: ReactNode;
  id: string;
  isTemporary?: boolean;
  order?: "With Previous" | "After Previous";
  title: ReactNode;
}

interface SortableItem<T> extends Item {
  data: T;
}

interface SortableListItemProps<T> {
  item: SortableItem<T>;
  items: SortableItem<T>[];
  order: number;
  onToggleItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  renderExtra?: (item: SortableItem<T>) => React.ReactNode;
  isExpanded?: boolean;
  className?: string;
  handleDrag: () => void;
}

function SortableListItem<T>({
  item,
  items,
  order,
  onToggleItem,
  onRemoveItem,
  renderExtra,
  handleDrag,
  isExpanded,
  className,
}: SortableListItemProps<T>) {
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggable] = useState(true);
  const dragControls = useDragControls();

  const handleDragStart = (event: any) => {
    setIsDragging(true);
    dragControls.start(event, { snapToCursor: true });
    handleDrag();
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  return (
    <div className={cn("", className)} key={item.id}>
      <div className="flex w-full items-center">
        <Reorder.Item
          value={item}
          className={cn(
            "relative z-auto grow",
            "h-full rounded-xl bg-card",
            "border border-border shadow-md",
            "dark:border-0 dark:shadow-[0px_1px_0px_0px_hsla(0,0%,100%,.03)_inset,0px_0px_0px_1px_hsla(0,0%,100%,.03)_inset,0px_0px_0px_1px_rgba(0,0,0,.1),0px_2px_2px_0px_rgba(0,0,0,.1),0px_4px_4px_0px_rgba(0,0,0,.1),0px_8px_8px_0px_rgba(0,0,0,.1)]",
            item.checked ? "cursor-not-allowed" : "cursor-grab",
            item.checked && !isDragging ? "w-7/10" : "w-full"
          )}
          key={item.id}
          dragListener={!item.checked}
          dragControls={dragControls}
          onDragEnd={handleDragEnd}
          style={
            isExpanded
              ? {
                  zIndex: 9999,
                  marginTop: 10,
                  marginBottom: 10,
                  position: "relative",
                  overflow: "hidden",
                }
              : {
                  position: "relative",
                  overflow: "hidden",
                }
          }
          whileDrag={{ zIndex: 9999 }}
        >
          <div className={cn(isExpanded ? "w-full" : "", "z-20 ")}>
            <div className="grid items-center justify-between grid-cols-[1fr_auto] w-full gap-2 py-1">
              {!isExpanded ? (
                <div className="flex w-full items-center gap-x-2 truncate">
                  {/* List Remove Actions */}
                  <Checkbox
                    checked={item.checked}
                    id={`checkbox-${item.id}`}
                    aria-label="Mark to delete"
                    onCheckedChange={() => onToggleItem(item.id)}
                    className="ml-3 border-foreground/20 bg-background/30 data-[state=checked]:bg-background data-[state=checked]:text-red-200 flex flex-shrink-0 "
                  />
                  {/* List Order */}
                  <p className="font-mono text-xs pl-1 text-foreground/50 flex flex-shrink-0">
                    {getParallelizedOrder(order, item, items)}
                  </p>

                  {/* List Title */}
                  <div
                    key={`${item.checked}`}
                    className="px-1 flex flex-grow truncate"
                  >
                    <HStack className="w-full justify-between">
                      {typeof item.title === "string" ? (
                        <h4
                          className={cn(
                            "flex tracking-tighter text-base md:text-lg truncate",
                            item.checked
                              ? "text-red-400"
                              : "text-foreground dark:text-foreground/70"
                          )}
                        >
                          {item.title}
                        </h4>
                      ) : (
                        <div className={item.checked ? "text-red-400" : ""}>
                          {item.title}
                        </div>
                      )}

                      {item.details && (
                        <div className="flex flex-shrink-0">{item.details}</div>
                      )}
                    </HStack>
                  </div>
                </div>
              ) : null}

              {/* List Item Children */}
              {renderExtra && renderExtra(item)}
            </div>
          </div>
          <div
            onPointerDown={isDraggable ? handleDragStart : undefined}
            style={{ touchAction: "none" }}
          />
        </Reorder.Item>
        {/* List Delete Action Animation */}

        {item.checked ? <div className="h-[1.5rem] w-3" /> : null}

        {item.checked ? (
          <div className="inset-0 z-0 rounded-full bg-card border-border border dark:shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_0_0_1px_rgba(255,255,255,0.03)_inset,0_0_0_1px_rgba(0,0,0,0.1),0_2px_2px_0_rgba(0,0,0,0.1),0_4px_4px_0_rgba(0,0,0,0.1),0_8px_8px_0_rgba(0,0,0,0.1)] dark:bg-[#161716]/50">
            <button
              className="inline-flex h-10 items-center justify-center space-nowrap rounded-md px-3 text-sm font-medium  transition-colors duration-150  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => onRemoveItem(item.id)}
            >
              <LuTrash className="h-4 w-4 text-red-400 transition-colors duration-150 fill-red-400/60 " />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type SortableItemRenderProps<T extends Item> = {
  item: T;
  items: T[];
  order: number;
  onToggleItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
};

interface SortableListProps<T extends Item> {
  items: T[];
  onToggleItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onReorder: (items: T[]) => void;
  renderItem: (props: SortableItemRenderProps<T>) => React.ReactNode;
}

function SortableList<T extends Item>({
  items,
  onRemoveItem,
  onToggleItem,
  onReorder,
  renderItem,
}: SortableListProps<T>) {
  if (items) {
    return (
      <LayoutGroup>
        <Reorder.Group
          axis="y"
          values={items}
          onReorder={onReorder}
          className="flex flex-col"
        >
          {items?.map((item, index) =>
            renderItem({
              item,
              items,
              order: index,
              onToggleItem,
              onRemoveItem,
            })
          )}
        </Reorder.Group>
      </LayoutGroup>
    );
  }
  return null;
}

SortableList.displayName = "SortableList";

export { SortableList, SortableListItem };

function getParallelizedOrder(index: number, item: Item, items: Item[]) {
  if (item?.order !== "With Previous") return index + 1;
  // traverse backwards through the list of items to find the first item that is not "With Previous" and return its index + 1
  for (let i = index - 1; i >= 0; i--) {
    if (items[i].order !== "With Previous") {
      return i + 1;
    }
  }

  return 1;
}
