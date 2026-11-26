// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  HStack,
  IconButton
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { LuEllipsisVertical } from "react-icons/lu";
import { Hyperlink } from "~/components";
import Grid from "~/components/Grid";
import { useQuantityFormatter } from "~/hooks";
import type { PlanningAction } from "~/modules/production/types";
import type { PlanningPurchaseOrder } from "./planning-review";
import type { PlanningActionHandlers } from "./PlanningActionLines";
import {
  ActionSuggestion,
  ORDER_GRID_MAX_HEIGHT,
  OrderRowsPending,
  SectionTitle,
  useSavingEditors
} from "./PlanningOrderGridParts";

// The drawer's Open Orders / Open Jobs: purchase order lines / jobs that
// already exist. A cell edit SAVES it (optimistic, reverted on failure), the
// way a count line or a Properties field does. Rows a status has locked are
// plain text.

export type OpenOrderRow = {
  /** The record a cell edit saves to: the PO LINE id, or the job id. */
  id: string;
  /** Where the readable id links to: the purchase order, or the job. */
  documentPath: string | null;
  readableId: string;
  status: string | null;
  /** In the order's own units — purchase units on a PO line. */
  quantity: number | null;
  dueDate: string | null;
  /** False once a status has locked the order (sent to the supplier, released
   *  to the floor): its cells render as plain text. */
  isEditable: boolean;
  /** The open (else dismissed) planning action that targets this order. */
  action: PlanningAction | null;
  /** The action's suggested quantity, converted to this row's units. */
  suggestedQuantity: number | null;
  /** The purchase order behind a PO line row, for the order's own menu
   *  (Reopen, Finalize). Jobs have none. */
  purchaseOrder?: PlanningPurchaseOrder | null;
};

/** The ⋯ of an order no planning action targets: only the order's own
 *  commands. Renders nothing when the host offers none for it. */
function OrderOnlyMenu({
  order,
  canUpdate,
  purchaseOrderMenuItems
}: {
  order: PlanningPurchaseOrder;
  canUpdate: boolean;
  purchaseOrderMenuItems: (order: PlanningPurchaseOrder) => ReactNode;
}) {
  const { t } = useLingui();
  const items = purchaseOrderMenuItems(order);
  if (!items) return null;
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t`More options`}
            icon={<LuEllipsisVertical />}
            isDisabled={!canUpdate}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{items}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export type OpenOrderField = "quantity" | "dueDate";

type OpenOrdersGridProps = PlanningActionHandlers & {
  title: ReactNode;
  documentHeader: string;
  quantityHeader: string;
  /** The order's status as an icon-only pill (`<XStatus iconOnly />`). */
  renderStatusIcon: (status: string) => ReactNode;
  /** `null` while the orders are being read; an `Error` when the read failed. */
  rows: OpenOrderRow[] | null | Error;
  /** Today on the location's calendar — a suggestion dated before it is late. */
  todayIso: string;
  /** Persist one field of one order. Resolve `false` (after reporting the
   *  reason) to have the cell revert. */
  onSave: (
    row: OpenOrderRow,
    field: OpenOrderField,
    value: number | string
  ) => Promise<boolean>;
  onRowsChange: (rows: OpenOrderRow[]) => void;
  /** A command for an order no planning action targets — the production
   *  drawer's Plan on a Draft job. Rendered in the Suggestion column. */
  renderRowCommand?: (row: OpenOrderRow) => ReactNode;
};

export function OpenOrdersGrid({
  title,
  documentHeader,
  quantityHeader,
  rows,
  todayIso,
  renderStatusIcon,
  onSave,
  onRowsChange,
  renderRowCommand,
  ...handlers
}: OpenOrdersGridProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const formatQuantity = useQuantityFormatter();

  const editableComponents = useSavingEditors<OpenOrderRow, OpenOrderField>(
    onSave
  );

  // `handlers` is a rest object, new on every render, so the memo depends on
  // its members instead.
  const columns = useMemo<ColumnDef<OpenOrderRow>[]>(
    () => [
      {
        // The order's status as an icon in front of its number, the name in
        // the icon's tooltip. The pill itself is the widest thing in the row
        // ("To Receive and Invoice"): as its own column it pushed the
        // suggestion off the drawer, and under the number it doubled the row
        // height. Here the status is context — why this row can or cannot be
        // edited — so the icon and its color are enough.
        id: "document",
        header: documentHeader,
        size: 190,
        cell: ({ row }) => (
          <HStack spacing={2} className="flex-nowrap">
            {row.original.status && renderStatusIcon(row.original.status)}
            {row.original.documentPath ? (
              <Hyperlink
                to={row.original.documentPath}
                className="whitespace-nowrap"
              >
                {row.original.readableId}
              </Hyperlink>
            ) : (
              <span className="whitespace-nowrap">
                {row.original.readableId}
              </span>
            )}
          </HStack>
        )
      },
      {
        accessorKey: "quantity",
        header: quantityHeader,
        size: 110,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.quantity === null
              ? "—"
              : formatQuantity(row.original.quantity)}
          </span>
        )
      },
      {
        accessorKey: "dueDate",
        header: t`Due Date`,
        size: 130,
        cell: ({ row }) => (
          <span
            className={
              // an open order due before today is overdue
              row.original.dueDate && row.original.dueDate < todayIso
                ? "whitespace-nowrap tabular-nums font-medium text-red-500"
                : "whitespace-nowrap tabular-nums"
            }
          >
            {row.original.dueDate
              ? formatDate(row.original.dueDate, undefined, locale)
              : "—"}
          </span>
        )
      },
      {
        // What MRP suggests for THIS order, on its own row: the type, the
        // value it would set (the reason is behind the info icon), and the
        // one button that acts on it.
        id: "suggestion",
        header: t`Suggestion`,
        size: 330,
        cell: ({ row }) => {
          const { action, suggestedQuantity, purchaseOrder } = row.original;
          if (!action) {
            const command = renderRowCommand?.(row.original);
            if (command) return command;
            return purchaseOrder && handlers.purchaseOrderMenuItems ? (
              <OrderOnlyMenu
                order={purchaseOrder}
                canUpdate={handlers.canUpdate}
                purchaseOrderMenuItems={handlers.purchaseOrderMenuItems}
              />
            ) : null;
          }
          return (
            <ActionSuggestion
              action={action}
              suggestedQuantity={suggestedQuantity}
              todayIso={todayIso}
              purchaseOrder={purchaseOrder}
              handlers={handlers}
            />
          );
        }
      }
    ],
    // oxlint-disable-next-line react/exhaustive-deps -- the handler members listed ARE `handlers`
    [
      documentHeader,
      quantityHeader,
      renderStatusIcon,
      renderRowCommand,
      formatQuantity,
      locale,
      todayIso,
      t,
      handlers.currentUserId,
      handlers.canUpdate,
      handlers.isBusy,
      handlers.onApply,
      handlers.onDismiss,
      handlers.onReopen,
      handlers.onAssignToMe,
      handlers.purchaseOrderMenuItems,
      handlers.canApply
    ]
  );

  const isRowEditable = useCallback((row: OpenOrderRow) => row.isEditable, []);

  // No open orders is the normal case for many parts: say nothing rather than
  // show an empty table. A failed read is NOT that case and says so.
  if (Array.isArray(rows) && rows.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-2">
      <SectionTitle>{title}</SectionTitle>
      {!Array.isArray(rows) ? (
        <OrderRowsPending rows={rows} />
      ) : (
        <Grid<OpenOrderRow>
          data={rows}
          columns={columns}
          canEdit={handlers.canUpdate}
          editableComponents={editableComponents}
          isRowEditable={isRowEditable}
          onDataChange={onRowsChange}
          contained={false}
          withSimpleSorting={false}
          maxHeight={ORDER_GRID_MAX_HEIGHT}
        />
      )}
    </div>
  );
}
