import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@carbon/react";
import type { Column, ColumnOrderState } from "@tanstack/react-table";
import { Reorder } from "framer-motion";
import {
  LuColumns2,
  LuEye,
  LuEyeOff,
  LuGripVertical,
  LuPin,
  LuPinOff,
} from "react-icons/lu";

type ColumnsProps<T> = {
  columns: Column<T, unknown>[];
  columnOrder: ColumnOrderState;
  withSelectableRows: boolean;
  setColumnOrder: (newOrder: ColumnOrderState) => void;
};

const Columns = <T extends object>({
  columns,
  columnOrder,
  withSelectableRows,
  setColumnOrder,
}: ColumnsProps<T>) => {
  return (
    <Drawer>
      <DrawerTrigger>
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              aria-label="Columns"
              title="Columns"
              variant="ghost"
              icon={<LuColumns2 />}
            />
          </TooltipTrigger>
          <TooltipContent>
            <p>Column visibility and order</p>
          </TooltipContent>
        </Tooltip>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Edit column visibility</DrawerTitle>
          <DrawerDescription>Hide, pin and reorder columns</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <Reorder.Group
            axis="y"
            values={columnOrder}
            onReorder={(newOrder: ColumnOrderState) => {
              if (withSelectableRows) newOrder.unshift("select");

              // Get first non-pinned column index
              const firstNonPinnedIndex = columns.findIndex(
                (col) => !col.getIsPinned() && isColumnToggable(col)
              );

              // For each column in new order, if it's before first non-pinned,
              // pin it to left and make visible. Otherwise unpin it.
              newOrder.forEach((columnId, index) => {
                const column = columns.find((col) => col.id === columnId);
                if (column && isColumnToggable(column)) {
                  if (index < firstNonPinnedIndex) {
                    column.pin("left");
                    if (!column.getIsVisible()) {
                      column.toggleVisibility(true);
                    }
                  } else if (column.getIsPinned()) {
                    column.pin(false);
                  }
                }
              });

              setColumnOrder(newOrder);
            }}
            className="w-full space-y-2"
          >
            {columns.reduce<JSX.Element[]>((acc, column, index) => {
              if (isColumnToggable(column)) {
                const prevColumn = columns[index - 1];
                const canPin =
                  !prevColumn ||
                  prevColumn.getIsPinned() ||
                  !isColumnToggable(prevColumn);

                acc.push(
                  <Reorder.Item
                    key={column.id}
                    value={column.id}
                    className="w-full rounded-lg"
                  >
                    <HStack className="w-full">
                      <IconButton
                        aria-label="Drag handle"
                        icon={<LuGripVertical />}
                        variant="ghost"
                      />
                      <span className="text-sm flex-grow flex items-center gap-2">
                        {column.columnDef.meta?.icon}
                        <>{column.columnDef.header}</>
                      </span>
                      <IconButton
                        aria-label="Toggle column"
                        icon={column.getIsPinned() ? <LuPin /> : <LuPinOff />}
                        onClick={() => {
                          if (column.getIsPinned()) {
                            column.pin(false);

                            // Get index of last pinned column
                            const lastPinnedIndex = columns.reduce(
                              (acc, col, i) => {
                                if (
                                  col.getIsPinned() &&
                                  isColumnToggable(col)
                                ) {
                                  return i;
                                }
                                return acc;
                              },
                              -1
                            );

                            // Move column after pinned columns
                            const newOrder = [...columnOrder];
                            const colIndex = newOrder.indexOf(column.id);
                            if (colIndex > -1) {
                              newOrder.splice(colIndex, 1);
                              newOrder.splice(
                                lastPinnedIndex + 1,
                                0,
                                column.id
                              );
                              setColumnOrder(newOrder);
                            }
                          } else if (canPin) {
                            column.pin("left");
                            // Make column visible when pinned
                            if (!column.getIsVisible()) {
                              column.toggleVisibility(true);
                            }
                          }
                        }}
                        variant="ghost"
                        disabled={!column.getIsPinned() && !canPin}
                      />
                      <IconButton
                        aria-label="Toggle column"
                        icon={column.getIsVisible() ? <LuEye /> : <LuEyeOff />}
                        onClick={() => {
                          // When hiding a column, unpin it and move after pinned columns
                          if (column.getIsVisible()) {
                            if (column.getIsPinned()) {
                              column.pin(false);

                              // Get index of last pinned column
                              const lastPinnedIndex = columns.reduce(
                                (acc, col, i) => {
                                  if (
                                    col.getIsPinned() &&
                                    isColumnToggable(col)
                                  ) {
                                    return i;
                                  }
                                  return acc;
                                },
                                -1
                              );

                              // Move column after pinned columns
                              const newOrder = [...columnOrder];
                              const colIndex = newOrder.indexOf(column.id);
                              if (colIndex > -1) {
                                newOrder.splice(colIndex, 1);
                                newOrder.splice(lastPinnedIndex, 0, column.id);
                                setColumnOrder(newOrder);
                              }
                            }
                          }
                          column.toggleVisibility();
                        }}
                        variant="ghost"
                      />
                    </HStack>
                  </Reorder.Item>
                );
              }
              return acc;
            }, [])}
          </Reorder.Group>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};

function isColumnToggable<T>(column: Column<T, unknown>): boolean {
  return (
    column.columnDef.id !== "select" &&
    typeof column.columnDef.header === "string" &&
    column.columnDef.header !== ""
  );
}

export default Columns;
