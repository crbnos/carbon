import type { Position } from "~/components/Editable";

/**
 * The subset of `Row`'s props the memo comparator reads. Kept in its own module
 * (types only, no runtime imports) so it can be unit tested without mounting the
 * table.
 */
export type RowMemoInputs = {
  row: unknown;
  visibleColumns: unknown;
  selectedCell: Position;
  rowIsSelected: boolean;
  isRowSelected?: boolean;
  isEditing: boolean;
  isEditMode: boolean;
  isFrozenColumn?: boolean;
  editedCells?: string[];
  className?: string;
  pinnedStyleKey?: string;
};

/**
 * Returns true to SKIP re-rendering the row.
 *
 * The version this replaced compared `next.selectedCell?.row === prev.row.index`.
 * `selectedCell` is null outside edit mode, so that compared `undefined` to a
 * number and always returned false — every row of every table re-rendered on
 * every render, which also defeated the `Cell` memo underneath.
 */
export function areRowPropsEqual(
  prev: RowMemoInputs,
  next: RowMemoInputs
): boolean {
  // TanStack reuses row objects while the data is unchanged, and memoizes
  // `getVisibleLeafColumns()`, so these two identities are the data and
  // column-layout guards respectively.
  if (prev.row !== next.row) return false;
  if (prev.visibleColumns !== next.visibleColumns) return false;

  if (prev.rowIsSelected !== next.rowIsSelected) return false;
  // Only the row owning the selected cell cares which column is selected.
  if (
    next.rowIsSelected &&
    prev.selectedCell?.column !== next.selectedCell?.column
  ) {
    return false;
  }

  return (
    prev.isRowSelected === next.isRowSelected &&
    prev.isEditing === next.isEditing &&
    prev.isEditMode === next.isEditMode &&
    prev.isFrozenColumn === next.isFrozenColumn &&
    prev.editedCells === next.editedCells &&
    prev.className === next.className &&
    prev.pinnedStyleKey === next.pinnedStyleKey
  );
}
