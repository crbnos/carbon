import { cn, Td } from "@carbon/react";
import type { Cell as CellType, Column } from "@tanstack/react-table";
import { flexRender } from "@tanstack/react-table";
import type { CSSProperties } from "react";
import { memo, useState } from "react";
import { LuPencil } from "react-icons/lu";
import type { EditableTableCellComponent } from "~/components/Editable";
import { useMovingCellRef } from "~/hooks";
import { getAccessorKey } from "../utils";

type CellProps<T> = {
  cell: CellType<T, unknown>;
  columnIndex: number;
  editableComponents?: Record<string, EditableTableCellComponent<T>>;
  editedCells?: string[];
  isEditing: boolean;
  isEditMode: boolean;
  isRowSelected: boolean;
  isSelected: boolean;
  pinnedColumns: string;
  getPinnedStyles: (column: Column<any, unknown>) => CSSProperties;
  onClick?: () => void;
  onUpdate?: (updates: Record<string, unknown>) => void;
  table: any;
};

const Cell = <T extends object>({
  cell,
  columnIndex,
  editableComponents,
  editedCells,
  isEditing,
  isEditMode,
  isSelected,
  getPinnedStyles,
  onClick,
  onUpdate,
  table
}: CellProps<T>) => {
  const { ref, tabIndex, onFocus } = useMovingCellRef(isSelected);
  const [hasError, setHasError] = useState(false);
  const accessorKey = getAccessorKey(cell.column.columnDef);

  const wasEdited =
    !!editedCells && !!accessorKey && editedCells.includes(accessorKey);

  const hasEditableTableCellComponent =
    accessorKey !== undefined &&
    editableComponents &&
    accessorKey in editableComponents;

  const editableCell = hasEditableTableCellComponent
    ? editableComponents[accessorKey]
    : null;

  const isPinned = cell.column.getIsPinned();

  // Inline-editable cells render as plain text until clicked; surface a subtle
  // pencil on hover so users can tell the value is editable.
  const showEditAffordance =
    isEditMode && hasEditableTableCellComponent && !isSelected;

  return (
    <Td
      className={cn(
        "group/cell relative py-2 whitespace-nowrap text-sm outline-none max-w-[30dvw] truncate",
        cell.column.id === "Select" ? "px-2" : "px-4",
        wasEdited && "bg-yellow-100 dark:bg-yellow-900",
        isEditMode && !hasEditableTableCellComponent && "bg-muted/50",
        isEditMode && "border-border border-r",
        hasError && "ring-inset ring-2 ring-red-500",
        // Only ring editable cells — a ring on a read-only cell wrongly signals
        // it can be edited.
        isSelected &&
          hasEditableTableCellComponent &&
          "!ring-inset !ring-2 !ring-ring",
        isSelected && hasEditableTableCellComponent && "!bg-background",
        "transition-[left,right,box-shadow] duration-200",
        isPinned && "bg-card"
      )}
      ref={ref}
      style={{
        ...getPinnedStyles(cell.column),
        width: cell.column.getSize(),
        margin: 0,
        borderSpacing: 0
      }}
      data-row={cell.row.index}
      data-column={columnIndex}
      tabIndex={tabIndex}
      onClick={onClick}
      onFocus={onFocus}
    >
      {isSelected && isEditing && hasEditableTableCellComponent ? (
        <div className="mx-[-0.65rem] my-[-0.25rem]">
          {hasEditableTableCellComponent
            ? flexRender(editableCell, {
                accessorKey,
                value: cell.renderValue(),
                row: cell.row.original,
                onUpdate: onUpdate
                  ? onUpdate
                  : () => console.error("No update function provided"),
                onError: () => {
                  setHasError(true);
                }
              })
            : null}
        </div>
      ) : (
        <div ref={ref}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
          {showEditAffordance && (
            <LuPencil
              aria-hidden
              className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/cell:opacity-60"
            />
          )}
        </div>
      )}
    </Td>
  );
};

const MemoizedCell = memo(
  Cell,
  (prev, next) =>
    next.isRowSelected === prev.isRowSelected &&
    next.isSelected === prev.isSelected &&
    next.isEditing === prev.isEditing &&
    next.isEditMode === prev.isEditMode &&
    next.cell.getValue() === prev.cell.getValue() &&
    next.cell.getContext() === prev.cell.getContext() &&
    next.pinnedColumns === prev.pinnedColumns &&
    next.columnIndex === prev.columnIndex
) as typeof Cell;

export default MemoizedCell;
