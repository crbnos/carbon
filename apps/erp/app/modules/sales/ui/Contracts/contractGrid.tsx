// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRevalidator } from "@carbon/query";
import { ActionMenu, toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { useCallback } from "react";
import type { ContractLine } from "./types";

/** The setup grids' Table has a container with `contain: strict`, so it
 *  takes its height from its parent: a header row and the footer row, each
 *  `h-11` (44px), the rows and the borders. A row is 44px, 49px with a row
 *  menu (its button), 53px when a cell stacks two lines. */
export function contractGridHeight(rowCount: number, rowHeight = 44) {
  return 88 + rowHeight * Math.max(rowCount, 1) + 4;
}

/** A contract line as a column header or a row label: its description, else
 *  its service item's name. */
export function contractLineName(line: ContractLine) {
  return line.description || line.item?.name || line.itemId;
}

/**
 * The row menu as an ordinary last column. The Table's own `renderContextMenu`
 * pins its menu column to the right edge, so when a grid is wider than the
 * page it sits on top of the Total column; this one scrolls with the row.
 */
export function rowMenuColumn<T>(
  render: (row: T) => ReactNode,
  label: string
): ColumnDef<T> {
  return {
    id: "rowMenu",
    header: () => <span className="sr-only">{label}</span>,
    cell: ({ row }) => {
      const items = render(row.original);
      return items ? (
        <div className="flex justify-end">
          <ActionMenu>{items}</ActionMenu>
        </div>
      ) : null;
    },
    size: 60
  };
}

/** The editable cells' column key for the line at `index`. Line ids are not
 *  used: the Table treats a key with `_` as a nested path. */
export const lineColumnKey = (index: number) => `line${index}`;

/**
 * Saves one grid cell: posts `fields` to `action` with `quiet` set, so the
 * route answers `{ error }` instead of a redirect and a flash. A failure
 * toasts and the cell reverts (the editable cells read `error`); a success
 * revalidates the contract so totals and footers follow.
 */
export function useContractCellSave() {
  const { t } = useLingui();
  const revalidator = useRevalidator();

  return useCallback(
    async (
      action: string,
      fields: Record<string, string>
    ): Promise<PostgrestSingleResponse<unknown>> => {
      const formData = new FormData();
      formData.set("quiet", "true");
      for (const [key, value] of Object.entries(fields)) {
        formData.set(key, value);
      }

      const response = await fetch(action, {
        method: "post",
        body: formData
      }).catch(() => null);
      const body = (await response?.json().catch(() => null)) as {
        error?: string | null;
      } | null;

      const message =
        !response?.ok || body?.error
          ? (body?.error ?? t`Failed to save the change`)
          : null;
      if (message) {
        toast.error(message);
      } else {
        revalidator.revalidate();
      }

      return {
        data: null,
        error: message ? { message } : null
      } as unknown as PostgrestSingleResponse<unknown>;
    },
    [revalidator, t]
  );
}
