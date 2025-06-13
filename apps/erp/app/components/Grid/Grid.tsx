import {
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
  cn,
  useEscape,
  useMount,
} from "@carbon/react";
import { clamp } from "@carbon/utils";
import type { ColumnDef, ColumnOrderState } from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuCirclePlus } from "react-icons/lu";
import type {
  EditableTableCellComponent,
  Position,
} from "~/components/Editable";
import { Row } from "./components";
import { getAccessorKey, updateNestedProperty } from "./utils";

interface GridProps<T extends object> {
  canEdit?: boolean;
  columns: ColumnDef<T>[];
  contained?: boolean;
  data: T[];
  defaultColumnOrder?: string[];
  defaultColumnVisibility?: Record<string, boolean>;
  editableComponents?: Record<string, EditableTableCellComponent<T>>;

  withNewRow?: boolean;
  withSimpleSorting?: boolean;
  onDataChange?: (data: T[]) => void;
  onEditRow?: (row: T) => void;
  onNewRow?: () => void;
}

const Grid = <T extends object>({
  canEdit = true,
  columns,
  contained = true,
  data,
  editableComponents,
  defaultColumnOrder,
  defaultColumnVisibility,
  withSimpleSorting = true,
  onDataChange,
  onEditRow,
  onNewRow,
}: GridProps<T>) => {
  const tableContainerRef = useRef<HTMLDivElement>(null);

  /* Data for Optimistic Updates */
  const [internalData, setInternalData] = useState<T[]>(data);
  useEffect(() => {
    setInternalData(data);
  }, [data]);

  /* Column Visibility */
  const [columnVisibility, setColumnVisibility] = useState(
    defaultColumnVisibility ?? {}
  );

  /* Column Ordering */
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(
    defaultColumnOrder ?? []
  );

  const table = useReactTable({
    data: internalData,
    columns: columns,
    state: {
      columnVisibility,
      columnOrder,
    },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      // These are not part of the standard API, but are accessible via table.options.meta
      editableComponents,
      updateData: (rowIndex, updates) => {
        setInternalData((previousData) => {
          const newData = previousData.map((row, index) => {
            if (index === rowIndex) {
              return Object.entries(updates).reduce(
                (newRow, [columnId, value]) => {
                  if (columnId.includes("_") && !(columnId in newRow)) {
                    updateNestedProperty(newRow, columnId, value);
                    return newRow;
                  } else {
                    return {
                      ...newRow,
                      [columnId]: value,
                    };
                  }
                },
                row
              );
            }
            return row;
          });

          onDataChange?.(newData);

          return newData;
        });
      },
    },
  });

  const [isEditing, setIsEditing] = useState(false);
  const [selectedCell, setSelectedCell] = useState<Position>(null);

  const focusOnSelectedCell = useCallback(() => {
    if (selectedCell == null) return;
    const cell = tableContainerRef.current?.querySelector(
      `[data-row="${selectedCell.row}"][data-column="${selectedCell.column}"]`
    ) as HTMLDivElement;
    if (cell) cell.focus();
  }, [selectedCell, tableContainerRef]);

  useEscape(() => {
    setIsEditing(false);
    focusOnSelectedCell();
  });

  const onSelectedCellChange = useCallback(
    (position: Position) => {
      if (
        selectedCell == null ||
        position == null ||
        selectedCell.row !== position?.row ||
        selectedCell.column !== position.column
      )
        setSelectedCell(position);
    },
    [selectedCell]
  );

  const isColumnEditable = useCallback(
    (selectedColumn: number) => {
      const tableColumns = [
        ...table.getLeftVisibleLeafColumns(),
        ...table.getCenterVisibleLeafColumns(),
      ];

      const column = tableColumns[selectedColumn];
      if (!column) return false;

      const accessorKey = getAccessorKey(column.columnDef);
      return (
        accessorKey && editableComponents && accessorKey in editableComponents
      );
    },
    [table, editableComponents]
  );

  const onCellClick = useCallback(
    (row: number, column: number) => {
      // ignore row select checkbox column
      if (
        selectedCell?.row === row &&
        selectedCell?.column === column &&
        isColumnEditable(column)
      ) {
        setIsEditing(true);
        return;
      }
      // ignore row select checkbox column
      if (column === -1) return;
      setIsEditing(false);
      onSelectedCellChange({ row, column });
    },
    [selectedCell, isColumnEditable, onSelectedCellChange]
  );

  const onCellUpdate = useCallback(
    (rowIndex: number) => (updates: Record<string, unknown>) =>
      table.options.meta?.updateData
        ? table.options.meta?.updateData(rowIndex, updates)
        : undefined,
    [table]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!selectedCell) return;

      const { code, shiftKey } = event;

      const commandCodes: {
        [key: string]: [number, number];
      } = {
        Tab: [0, 1],
        Enter: [1, 0],
      };

      const navigationCodes: {
        [key: string]: [number, number];
      } = {
        ArrowRight: [0, 1],
        ArrowLeft: [0, -1],
        ArrowDown: [1, 0],
        ArrowUp: [-1, 0],
      };

      const lastRow = table.getRowModel().rows.length - 1;
      const lastColumn = table.getVisibleLeafColumns().length - 1;

      const navigate = (
        delta: [number, number],
        tabWrap = false
      ): [number, number] => {
        const x0 = selectedCell?.column || 0;
        const y0 = selectedCell?.row || 0;

        let x1 = x0 + delta[1];
        let y1 = y0 + delta[0];

        if (tabWrap) {
          if (delta[1] > 0) {
            // wrap to the next row if we're on the last column
            if (x1 > lastColumn) {
              x1 = 0;
              y1 += 1;
            }
            // don't wrap to the next row if we're on the last row
            if (y1 > lastRow) {
              x1 = x0;
              y1 = y0;
            }
          } else {
            // reverse tab wrap
            if (x1 < 0) {
              x1 = lastColumn;
              y1 -= 1;
            }

            if (y1 < 0) {
              x1 = x0;
              y1 = y0;
            }
          }
        } else {
          x1 = clamp(x1, 0, lastColumn);
        }

        y1 = clamp(y1, 0, lastRow);

        return [x1, y1];
      };

      if (code in commandCodes) {
        event.preventDefault();

        if (
          canEdit &&
          !isEditing &&
          code === "Enter" &&
          !shiftKey &&
          isColumnEditable(selectedCell.column)
        ) {
          setIsEditing(true);
          return;
        }

        let direction = commandCodes[code];

        if (shiftKey) direction = [-direction[0], -direction[1]];
        const [x1, y1] = navigate(direction, code === "Tab");
        setSelectedCell({
          row: y1,
          column: x1,
        });
        if (isEditing) {
          setIsEditing(false);
        }
      } else if (code in navigationCodes) {
        // arrow key navigation should't work if we're editing
        if (isEditing) return;
        event.preventDefault();
        const [x1, y1] = navigate(navigationCodes[code], code === "Tab");
        setIsEditing(false);
        setSelectedCell({
          row: y1,
          column: x1,
        });
        // any other key (besides shift) activates editing
        // if the column is editable and a cell is selected
      } else if (
        !["ShiftLeft", "ShiftRight"].includes(code) &&
        !isEditing &&
        selectedCell &&
        isColumnEditable(selectedCell.column)
      ) {
        setIsEditing(true);
      }
    },
    [canEdit, isColumnEditable, isEditing, selectedCell, table]
  );

  // reset the selected cell when the table data changes
  useEffect(() => {
    setSelectedCell(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder, columnVisibility]);

  useMount(() => {
    setColumnOrder(table.getAllLeafColumns().map((column) => column.id));
  });

  const rows = table.getRowModel().rows;

  return (
    <VStack spacing={0} className="h-full w-full">
      <div
        className={cn(
          "w-full h-full overflow-x-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent",
          contained ? "bg-card" : "relative"
        )}
        ref={tableContainerRef}
        onKeyDown={onKeyDown}
      >
        <Table
          full={contained}
          className={cn("border", !contained && "w-full")}
        >
          <Thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <Tr key={headerGroup.id} className="h-10">
                {headerGroup.headers.map((header) => {
                  const accessorKey = getAccessorKey(header.column.columnDef);

                  const sortable =
                    withSimpleSorting &&
                    accessorKey &&
                    !accessorKey.endsWith(".id") &&
                    header.column.columnDef.enableSorting !== false;

                  return (
                    <Th
                      key={header.id}
                      colSpan={header.colSpan}
                      className={cn(
                        "border-r border-border px-4 py-3 whitespace-nowrap text-sm",
                        sortable && "cursor-pointer"
                      )}
                      style={{
                        width: header.getSize(),
                      }}
                    >
                      {header.isPlaceholder ? null : (
                        <div className="flex justify-start items-center text-xs text-zinc-500">
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                        </div>
                      )}
                    </Th>
                  );
                })}
              </Tr>
            ))}
          </Thead>
          <Tbody>
            {rows.map((row) => {
              return (
                <Row
                  key={row.id}
                  editableComponents={canEdit ? editableComponents : {}}
                  isEditing={isEditing}
                  selectedCell={selectedCell}
                  row={row}
                  rowIsSelected={selectedCell?.row === row.index}
                  onCellClick={onCellClick}
                  onCellUpdate={onCellUpdate}
                  onEditRow={onEditRow}
                />
              );
            })}
            {rows.length === 0 && !onNewRow && (
              <Tr className="h-10 hover:bg-muted/50">
                <Td colSpan={24}>
                  <p className="text-muted-foreground text-center w-full">
                    No Data
                  </p>
                </Td>
              </Tr>
            )}
            {onNewRow && (
              <Tr
                onClick={onNewRow}
                className="cursor-pointer h-10 hover:bg-muted/50 border-t"
              >
                <Td colSpan={24}>
                  <HStack className="items-start h-6">
                    <LuCirclePlus className="text-muted-foreground h-6 w-6" />
                  </HStack>
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </div>
    </VStack>
  );
};

export default Grid;
