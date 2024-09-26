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
} from "@carbon/react";
import type { Column, ColumnOrderState } from "@tanstack/react-table";
import { Reorder } from "framer-motion";
import { LuColumns, LuEye, LuEyeOff, LuPin, LuPinOff } from "react-icons/lu";
import { MdOutlineDragIndicator } from "react-icons/md";

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
      <DrawerTrigger asChild>
        <IconButton
          aria-label="Columns"
          title="Columns"
          variant="ghost"
          icon={<LuColumns />}
        />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Edit column view</DrawerTitle>
          <DrawerDescription>Manage and reorder columns</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <Reorder.Group
            axis="y"
            values={columnOrder}
            onReorder={(newOrder: ColumnOrderState) => {
              if (withSelectableRows) newOrder.unshift("select");
              setColumnOrder(newOrder);
            }}
            className="w-full space-y-2"
          >
            {columns.reduce<JSX.Element[]>((acc, column) => {
              if (isColumnToggable(column))
                acc.push(
                  <Reorder.Item
                    key={column.id}
                    value={column.id}
                    className="w-full rounded-lg"
                  >
                    <HStack className="w-full">
                      <IconButton
                        aria-label="Drag handle"
                        icon={<MdOutlineDragIndicator />}
                        variant="ghost"
                      />
                      <span className="text-sm flex-grow">
                        <>{column.columnDef.header}</>
                      </span>
                      <IconButton
                        aria-label="Toggle column"
                        icon={column.getIsPinned() ? <LuPin /> : <LuPinOff />}
                        onClick={(e) => {
                          if (column.getIsPinned()) {
                            column.pin(false);
                          } else {
                            column.pin("left");
                            // when a column is pinned, we assure that it's visible
                            if (!column.getIsVisible()) {
                              column.getToggleVisibilityHandler()(e);
                            }
                          }
                        }}
                        variant="ghost"
                      />
                      <IconButton
                        aria-label="Toggle column"
                        icon={column.getIsVisible() ? <LuEye /> : <LuEyeOff />}
                        onClick={column.getToggleVisibilityHandler()}
                        variant="ghost"
                      />
                    </HStack>
                  </Reorder.Item>
                );
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
