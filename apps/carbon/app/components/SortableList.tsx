"use client";

import {
  AnimatePresence,
  LayoutGroup,
  Reorder,
  motion,
  useDragControls,
} from "framer-motion";
import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import useMeasure from "react-use-measure";

import { Checkbox, cn } from "@carbon/react";
import { LuTrash } from "react-icons/lu";

export interface Item {
  id: string;
  text: string;
  checked: boolean;
  order?: "With Previous" | "After Previous";
}

interface SortableItem<T> extends Item {
  data: T;
}

interface SortableListItemProps<T> {
  item: SortableItem<T>;
  items: SortableItem<T>[];
  order: number;
  onCompleteItem: (id: string) => void;
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
  onCompleteItem,
  onRemoveItem,
  renderExtra,
  handleDrag,
  isExpanded,
  className,
}: SortableListItemProps<T>) {
  let [ref, bounds] = useMeasure();
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
    <motion.div className={cn("", className)} key={item.id}>
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
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            height: bounds.height > 0 ? bounds.height : undefined,
            transition: {
              type: "spring",
              bounce: 0,
              duration: 0.4,
            },
          }}
          exit={{
            opacity: 0,
            transition: {
              duration: 0.05,
              type: "spring",
              bounce: 0.1,
            },
          }}
          layout
          layoutId={`item-${item.id}`}
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
          <div ref={ref} className={cn(isExpanded ? "" : "", "z-20 ")}>
            <motion.div
              layout="position"
              className="flex items-center justify-center "
            >
              <AnimatePresence>
                {!isExpanded ? (
                  <motion.div
                    initial={{ opacity: 0, filter: "blur(4px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, filter: "blur(4px)" }}
                    transition={{ duration: 0.001 }}
                    className="flex  items-center space-x-2 "
                  >
                    {/* List Remove Actions */}
                    <Checkbox
                      checked={item.checked}
                      id={`checkbox-${item.id}`}
                      aria-label="Mark to delete"
                      onCheckedChange={() => onCompleteItem(item.id)}
                      className=" ml-3 h-5 w-5 rounded-md border-foreground/20 bg-background/30 data-[state=checked]:bg-background data-[state=checked]:text-red-200"
                    />
                    {/* List Order */}
                    <p className="font-mono text-xs pl-1 text-foreground/50 flex flex-shrink-0">
                      {getParallelizedOrder(order, item, items)}
                    </p>

                    {/* List Title */}
                    <motion.div
                      key={`${item.checked}`}
                      className=" px-1 flex flex-grow truncate"
                      initial={{
                        opacity: 0,
                        filter: "blur(4px)",
                      }}
                      animate={{ opacity: 1, filter: "blur(0px)" }}
                      transition={{
                        bounce: 0.2,
                        delay: item.checked ? 0.2 : 0,
                        type: "spring",
                      }}
                    >
                      <h4
                        className={cn(
                          "tracking-tighter text-base md:text-lg ",
                          item.checked
                            ? "text-red-400"
                            : "text-foreground dark:text-foreground/70"
                        )}
                      >
                        {item.text}
                      </h4>
                    </motion.div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* List Item Children */}
              {renderExtra && renderExtra(item)}
            </motion.div>
          </div>
          <div
            onPointerDown={isDraggable ? handleDragStart : undefined}
            style={{ touchAction: "none" }}
          />
        </Reorder.Item>
        {/* List Delete Action Animation */}
        <AnimatePresence mode="popLayout">
          {item.checked ? (
            <motion.div
              layout
              initial={{ opacity: 0, x: -10 }}
              animate={{
                opacity: 1,
                x: 0,
                transition: {
                  delay: 0.17,
                  duration: 0.17,
                  type: "spring",
                  bounce: 0.6,
                },
                zIndex: 5,
              }}
              exit={{
                opacity: 0,
                x: -5,
                transition: {
                  delay: 0,
                  duration: 0.0,
                  type: "spring",
                  bounce: 0,
                },
              }}
              className="h-[1.5rem] w-3"
            />
          ) : null}
        </AnimatePresence>
        <AnimatePresence mode="popLayout">
          {item.checked ? (
            <motion.div
              layout
              initial={{ opacity: 0, x: -5, filter: "blur(4px)" }}
              animate={{
                opacity: 1,
                x: 0,
                filter: "blur(0px)",
                transition: {
                  delay: 0.3,
                  duration: 0.15,
                  type: "spring",
                  bounce: 0.9,
                },
              }}
              exit={{
                opacity: 0,
                filter: "blur(4px)",
                x: -10,
                transition: { delay: 0, duration: 0.12 },
              }}
              className="inset-0 z-0 rounded-full bg-card border-border border dark:shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_0_0_1px_rgba(255,255,255,0.03)_inset,0_0_0_1px_rgba(0,0,0,0.1),0_2px_2px_0_rgba(0,0,0,0.1),0_4px_4px_0_rgba(0,0,0,0.1),0_8px_8px_0_rgba(0,0,0,0.1)] dark:bg-[#161716]/50"
            >
              <button
                className="inline-flex h-10 items-center justify-center space-nowrap rounded-md px-3 text-sm font-medium  transition-colors duration-150  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                onClick={() => onRemoveItem(item.id)}
              >
                <LuTrash className="h-4 w-4 text-red-400 transition-colors duration-150 fill-red-400/60 " />
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

SortableListItem.displayName = "SortableListItem";

export type SortableItemRenderProps<T extends Item> = {
  item: T;
  items: T[];
  order: number;
  onCompleteItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
};

interface SortableListProps<T extends Item> {
  items: T[];
  onCompleteItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onReorder: Dispatch<SetStateAction<T[]>>;
  renderItem: (props: SortableItemRenderProps<T>) => React.ReactNode;
}

function SortableList<T extends Item>({
  items,
  onRemoveItem,
  onCompleteItem,
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
          <AnimatePresence>
            {items?.map((item, index) =>
              renderItem({
                item,
                items,
                order: index,
                onCompleteItem,
                onRemoveItem,
              })
            )}
          </AnimatePresence>
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
