// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Skeleton
} from "@carbon/react";
import { formatDate, INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { Hyperlink } from "~/components";
import { EditableDate, EditableNumber } from "~/components/Editable";
import Grid from "~/components/Grid";
import { useAfterFirstPaint, useQuantityFormatter } from "~/hooks";
import type { PlanningAction } from "~/modules/production";
import type { PlanningActionHandlers } from "./PlanningActionLines";
import {
  PlanningActionRowActions,
  PlanningActionTypeWithReason
} from "./PlanningActionLines";
import type { PlanningPurchaseOrder } from "./planning-review";
import { isPlanningActionLate } from "./planning-review";

// The two tables of the planning order drawer. They look alike and save
// DIFFERENTLY, which is why they are two tables and not one list:
//
//   SuggestedOrdersGrid — orders that do not exist yet. Editing a cell changes
//     a draft held by the planning grid; nothing is written until the drawer's
//     Order / Make button creates them.
//   OpenOrdersGrid — purchase order lines / jobs that already exist. Editing a
//     cell SAVES it (optimistic, reverted on failure), the way a count line or
//     a Properties field does. Rows a status has locked are plain text.
//
// One list with both kinds hid that difference: an edit to an existing order
// sat unsaved until Order was pressed, and was dropped by Close.

const SAVED = {
  success: true,
  data: null,
  error: null,
  count: null,
  status: 200,
  statusText: "OK"
} as const;

/** A draft cell has nothing to persist: the grid's `onDataChange` is the save. */
const draftMutation = async () => SAVED;

/** An editable quantity commits `parse(format(x))` on blur, so it needs the
 *  quantity kind's digits and step — Intl's default would round to three. */
const QUANTITY_FIELD = {
  minValue: 0,
  formatOptions: INPUT_FORMAT.quantity,
  step: INPUT_STEP.quantity
};

function SectionTitle({
  children,
  action
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <HStack className="w-full justify-between min-h-8">
      <span className="font-medium text-sm">{children}</span>
      {action}
    </HStack>
  );
}

// ─── Suggested orders (draft) ────────────────────────────────────────────────

type SuggestedOrder = {
  quantity: number;
  dueDate?: string | null;
};

type SuggestedOrdersGridProps<O extends SuggestedOrder> = {
  title: ReactNode;
  /** Shown at the right of the title — the "N More After <fence>" button. */
  titleAction?: ReactNode;
  orders: O[];
  /** Days between placing the order and receiving it, for the Order By date. */
  leadTime: number;
  /** Today on the location's calendar (ISO), to flag an order-by date that has
   *  already passed. */
  todayIso: string;
  quantityHeader: string;
  /** Header of the derived "last day to act" column: a purchase is ordered
   *  by that day, a job is started by it. */
  orderByHeader: string;
  isDisabled?: boolean;
  onChange: (orders: O[]) => void;
  onAdd: () => void;
};

/**
 * Holds the drawer's expensive sections (the two grids and the chart) back
 * until the drawer itself is on screen.
 *
 * Built in the same pass as the drawer they kept the click from showing
 * anything for 200 ms on a part with a handful of orders, and far longer on one
 * with forty: every open order mounts tooltips, a menu and editable cells. With
 * this the drawer slides in at once over placeholders of about the right size,
 * and the sections fill in a frame or two later.
 */
export function DeferredDrawerSections({ children }: { children: ReactNode }) {
  const isPainted = useAfterFirstPaint();

  if (!isPainted) {
    return (
      <div className="flex w-full flex-col gap-4" aria-busy="true">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return <>{children}</>;
}

// About eight orders tall. A part can have hundreds of open orders; past this
// the grid scrolls inside itself and renders only the rows in view. That grid
// lays its columns out fixed, so each column's `size` IS its width.
const ORDER_GRID_MAX_HEIGHT = 400;

export function SuggestedOrdersGrid<O extends SuggestedOrder>({
  title,
  titleAction,
  orders,
  leadTime,
  todayIso,
  quantityHeader,
  orderByHeader,
  isDisabled = false,
  onChange,
  onAdd
}: SuggestedOrdersGridProps<O>) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const formatQuantity = useQuantityFormatter();

  const editableComponents = useMemo(
    () => ({
      quantity: EditableNumber<O>(draftMutation, QUANTITY_FIELD),
      dueDate: EditableDate<O>(draftMutation)
    }),
    []
  );

  const columns = useMemo<ColumnDef<O>[]>(() => {
    const cols: ColumnDef<O>[] = [
      {
        accessorKey: "quantity",
        header: quantityHeader,
        size: 120,
        cell: ({ row }) => (
          <span className="block min-w-[72px] tabular-nums">
            {formatQuantity(row.original.quantity)}
          </span>
        )
      },
      {
        accessorKey: "dueDate",
        header: t`Due Date`,
        size: 140,
        cell: ({ row }) => (
          <span className="block min-w-[104px] tabular-nums">
            {row.original.dueDate
              ? formatDate(row.original.dueDate, undefined, locale)
              : "—"}
          </span>
        )
      },
      {
        // The last day to place the order and still receive it by the due
        // date. Derived from the row's CURRENT due date, so it moves with an
        // edit; red once that day has passed.
        id: "orderBy",
        header: orderByHeader,
        size: 140,
        cell: ({ row }) => {
          const dueDate = row.original.dueDate;
          if (!dueDate) return "—";
          const orderBy = parseDate(dueDate)
            .subtract({ days: leadTime })
            .toString();
          return (
            <span
              className={
                orderBy < todayIso
                  ? "tabular-nums font-medium text-red-500"
                  : "tabular-nums"
              }
            >
              {formatDate(orderBy, undefined, locale)}
            </span>
          );
        }
      }
    ];

    // A suggestion is unsaved state until Order is pressed, so removing one
    // costs nothing and needs no confirmation — one click, as price breaks do.
    if (!isDisabled) {
      cols.push({
        id: "remove",
        header: "",
        size: 48,
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={t`Remove order`}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
            onClick={(event) => {
              event.stopPropagation();
              onChange(orders.filter((_, index) => index !== row.index));
            }}
          >
            <LuTrash className="size-4" />
          </button>
        )
      });
    }

    return cols;
  }, [
    quantityHeader,
    orderByHeader,
    formatQuantity,
    locale,
    leadTime,
    todayIso,
    isDisabled,
    orders,
    onChange,
    t
  ]);

  return (
    <div className="flex w-full flex-col gap-2">
      <SectionTitle action={titleAction}>{title}</SectionTitle>
      <Grid<O>
        data={orders}
        columns={columns}
        canEdit={!isDisabled}
        editableComponents={editableComponents}
        onDataChange={onChange}
        onNewRow={!isDisabled ? onAdd : undefined}
        contained={false}
        withSimpleSorting={false}
        maxHeight={ORDER_GRID_MAX_HEIGHT}
      />
    </div>
  );
}

// ─── Open orders (saved) ─────────────────────────────────────────────────────

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

const QUANTITY_ACTION_TYPES: ReadonlySet<string> = new Set([
  "Increase",
  "Decrease"
]);
const DATE_ACTION_TYPES: ReadonlySet<string> = new Set([
  "Expedite",
  "Defer",
  "Release"
]);

// The Due Date cell beside it already carries the year; the suggested date
// only needs to be told apart from it, and the drawer is narrow.
const SHORT_DATE = { month: "short", day: "numeric" } as const;

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

  // The editors must keep their identity for the life of the drawer: each
  // `EditableNumber` / `EditableDate` call returns a NEW component, so rebuilding
  // them remounts the open editor and drops what the planner is typing (Tab
  // carries the edit into the next cell while the previous save is in flight,
  // and the caller's `onSave` changes when that save revalidates). The latest
  // `onSave` is read through a ref instead — React 18 has no useEffectEvent.
  const latestOnSave = useRef(onSave);
  useEffect(() => {
    latestOnSave.current = onSave;
  });

  const editableComponents = useMemo(() => {
    const saveCell = async (
      accessorKey: string,
      value: unknown,
      row: OpenOrderRow
    ): Promise<PostgrestSingleResponse<unknown>> => {
      const field = accessorKey as OpenOrderField;
      const saved = await latestOnSave.current(
        row,
        field,
        field === "quantity" ? Number(value) : String(value)
      );
      return (saved
        ? SAVED
        : {
            ...SAVED,
            error: { message: "Not saved" }
          }) as unknown as PostgrestSingleResponse<unknown>;
    };
    return {
      quantity: EditableNumber<OpenOrderRow>(saveCell, QUANTITY_FIELD),
      dueDate: EditableDate<OpenOrderRow>(saveCell)
    };
  }, []);

  // `handlers` is a rest object, new on every render, so the memo depends on
  // its members instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the handler members listed ARE `handlers`
  const columns = useMemo<ColumnDef<OpenOrderRow>[]>(
    () => [
      {
        // The order's status as an icon in front of its number, the name in
        // the icon's tooltip. The pill itself is the widest thing in the row
        // ("To Receive and Invoice"): as its own column it pushed the
        // suggestion off the drawer, and under the number it doubled the row
        // height. Here the status is context — why this row can or cannot be
        // edited — so the icon and its colour are enough.
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
          const isDismissed = action.status === "Dismissed";
          return (
            <HStack spacing={2} className="flex-nowrap justify-between">
              <HStack
                spacing={2}
                className={
                  isDismissed
                    ? "flex-nowrap whitespace-nowrap text-muted-foreground"
                    : "flex-nowrap whitespace-nowrap"
                }
              >
                <PlanningActionTypeWithReason action={action} />
                {DATE_ACTION_TYPES.has(action.type) && (
                  <span
                    className={
                      // the same rule as the expanded row: an urgent action
                      // (or a Release) whose day has passed
                      isPlanningActionLate(action, todayIso)
                        ? "tabular-nums font-medium text-red-500"
                        : "tabular-nums"
                    }
                  >
                    {formatDate(action.suggestedDate, SHORT_DATE, locale)}
                  </span>
                )}
                {QUANTITY_ACTION_TYPES.has(action.type) &&
                  suggestedQuantity !== null && (
                    <span className="tabular-nums">
                      {formatQuantity(suggestedQuantity)}
                    </span>
                  )}
              </HStack>
              <PlanningActionRowActions
                action={action}
                purchaseOrder={purchaseOrder}
                {...handlers}
              />
            </HStack>
          );
        }
      }
    ],
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
      handlers.purchaseOrderMenuItems
    ]
  );

  const isRowEditable = useCallback((row: OpenOrderRow) => row.isEditable, []);

  // No open orders is the normal case for many parts: say nothing rather than
  // show an empty table. A failed read is NOT that case and says so.
  if (Array.isArray(rows) && rows.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-2">
      <SectionTitle>{title}</SectionTitle>
      {rows === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : rows instanceof Error ? (
        <span className="text-sm text-muted-foreground">
          <Trans>
            These orders could not be loaded. Close and reopen to try again.
          </Trans>
        </span>
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

/**
 * The one planning action to show on an order's row: MRP emits at most one
 * change per target document, but a dismissed one can coexist with a newer
 * open one — the open action wins — and a planned order also carries its
 * Release. A change comes first (make it, then release the order); the
 * Release shows when there is nothing to change.
 */
export function actionForOrder(
  actions: PlanningAction[],
  matches: (action: PlanningAction) => boolean
): PlanningAction | null {
  const mine = actions.filter(matches);
  const open = mine.filter((a) => a.status === "Open");
  return open.find((a) => a.type !== "Release") ?? open[0] ?? mine[0] ?? null;
}
