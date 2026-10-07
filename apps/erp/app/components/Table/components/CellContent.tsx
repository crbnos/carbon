// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Cell as CellType } from "@tanstack/react-table";
import { flexRender } from "@tanstack/react-table";

/**
 * Renders the column's cell under ONE component type.
 *
 * `flexRender` renders a cell function as `<cell />`, so the function IS the
 * component type. Column definitions are rebuilt whenever something they close
 * over changes (the loaded rows, a translation, a row-action callback), which
 * gives every cell a new type: React then destroys and recreates the content of
 * every cell in the table. A reload of the list behind a drawer made each row's
 * buttons, links and thumbnails flicker. Calling the function from a stable
 * wrapper lets React update the cell in place.
 */
export function CellContent<T>({ cell }: { cell: CellType<T, unknown> }) {
  const render = cell.column.columnDef.cell;
  if (
    typeof render !== "function" ||
    // A class component cannot be called.
    (render as { prototype?: { isReactComponent?: unknown } }).prototype
      ?.isReactComponent
  ) {
    return <>{flexRender(render, cell.getContext())}</>;
  }
  return <>{render(cell.getContext())}</>;
}
