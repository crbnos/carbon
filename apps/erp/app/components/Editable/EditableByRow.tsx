// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ReactNode } from "react";
import type {
  EditableTableCellComponent,
  EditableTableCellComponentProps
} from "./types";

/**
 * One editable column whose editor depends on the row: the plan line Type
 * picks a different editor per row, a locked timesheet cell shows text.
 *
 * `pick` returns the editor for a row, or `null` for a row that is not
 * editable, which renders `readOnly(props)` instead. Every editor that `pick`
 * returns must keep its identity across renders — build them once with
 * `useStableEditableComponents`, or the open editor remounts and drops what
 * the user is typing.
 */
export default function EditableByRow<T>(
  pick: (row: T) => EditableTableCellComponent<T> | null,
  readOnly: (props: EditableTableCellComponentProps<T>) => ReactNode
): EditableTableCellComponent<T> {
  function EditableByRowCell(props: EditableTableCellComponentProps<T>) {
    const Editor = pick(props.row);
    if (Editor) return <Editor {...props} />;
    return <>{readOnly(props)}</>;
  }
  return EditableByRowCell;
}
