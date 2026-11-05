// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type EditableTableCellComponent<TData> = (
  props: EditableTableCellComponentProps<TData>
) => JSX.Element;

export type EditableTableCellComponentProps<T> = {
  value: unknown;
  row: T;
  accessorKey: string;
  /**
   * The column's display name (its header text), for the editor's accessible
   * name — the editor mounts only while the cell is being edited, with no
   * visible label of its own.
   */
  label?: string;
  onUpdate: (updates: Record<string, unknown>) => void;
  onError: () => void;
};

export type Position = null | { row: number; column: number };

declare module "@tanstack/react-table" {
  interface TableMeta<TData> {
    editableComponents?: Record<string, EditableTableCellComponent<TData>>;
    updateData?: (rowIndex: number, updates: Record<string, unknown>) => void;
    /** Names a row in its controls' labels ("Actions for PO-000123"). */
    getRowLabel?: (row: TData) => string | undefined;
  }
}
