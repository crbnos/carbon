// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, Tr } from "@carbon/react";
import type { Row as RowType } from "@tanstack/react-table";
import type { MutableRefObject } from "react";
import { memo } from "react";
import type {
  EditableTableCellComponent,
  Position
} from "~/components/Editable";
import Cell from "./Cell";

type RowProps<T> = {
  editableComponents?: Record<string, EditableTableCellComponent<T> | object>;
  editedCells?: string[];
  isEditing: boolean;
  selectedCell: Position;
  row: RowType<T>;
  rowIsClickable?: boolean;
  rowIsSelected: boolean;
  rowRef?: MutableRefObject<HTMLTableRowElement | null>;
  onCellClick: (row: number, column: number) => void;
  onCellUpdate: (row: number) => (updates: Record<string, unknown>) => void;
  onEditRow?: (row: T) => void;
};

const Row = <T extends object>({
  editableComponents,
  editedCells,
  isEditing,
  row,
  rowIsClickable = false,
  rowIsSelected,
  rowRef,
  selectedCell,
  onCellClick,
  onCellUpdate
}: RowProps<T>) => {
  const onUpdate = onCellUpdate(row.index);

  return (
    <Tr
      key={row.id}
      ref={rowRef}
      className={cn(rowIsClickable && "cursor-pointer")}
    >
      {row.getVisibleCells().map((cell, columnIndex) => {
        const isSelected =
          selectedCell?.row === cell.row.index &&
          selectedCell?.column === columnIndex;

        return (
          <Cell<T>
            key={cell.id}
            cell={cell}
            columnIndex={columnIndex}
            // @ts-expect-error
            editableComponents={editableComponents}
            editedCells={editedCells}
            isSelected={isSelected}
            isEditing={isEditing}
            onClick={() => onCellClick(cell.row.index, columnIndex)}
            onUpdate={onUpdate}
          />
        );
      })}
    </Tr>
  );
};

const MemoizedRow = memo(
  Row,
  (prev, next) =>
    next.rowIsSelected === false &&
    prev.rowIsSelected === false &&
    next.selectedCell?.row === prev.row.index &&
    next.row.index === prev.selectedCell?.row &&
    next.selectedCell?.column === prev.selectedCell?.column &&
    next.isEditing === prev.isEditing
) as typeof Row;

// props are equal if:
// - the row is not the selected row

export default MemoizedRow;
