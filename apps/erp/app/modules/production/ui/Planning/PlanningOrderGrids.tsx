// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { HStack, Skeleton } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { LuTrash } from "react-icons/lu";
import { Hyperlink } from "~/components";
import { EditableDate, EditableNumber } from "~/components/Editable";
import Grid from "~/components/Grid";
import { useQuantityFormatter } from "~/hooks";
import type { PlanningAction } from "~/modules/production";
import type { PlanningActionHandlers } from "./PlanningActionLines";
import {
  PlanningActionRowActions,
  PlanningActionTypeWithReason
} from "./PlanningActionLines";

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
  data: null,
  error: null,
  count: null,
  status: 200,
  statusText: "OK"
} as const;

/** A draft cell has nothing to persist: the grid's `onDataChange` is the save. */
const draftMutation = async () => SAVED;

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
      quantity: EditableNumber<O>(draftMutation, { minValue: 0 }),
      dueDate: EditableDate<O>(draftMutation)
    }),
    []
  );

  const columns = useMemo<ColumnDef<O>[]>(() => {
    const cols: ColumnDef<O>[] = [
      {
        accessorKey: "quantity",
        header: quantityHeader,
        cell: ({ row }) => (
          <span className="block min-w-[72px] tabular-nums">
            {formatQuantity(row.original.quantity)}
          </span>
        )
      },
      {
        accessorKey: "dueDate",
        header: t`Due Date`,
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
        size: 40,
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
};

export type OpenOrderField = "quantity" | "dueDate";

type OpenOrdersGridProps = PlanningActionHandlers & {
  title: ReactNode;
  documentHeader: string;
  quantityHeader: string;
  /** The order's status as an icon-only pill (`<XStatus iconOnly />`). */
  renderStatusIcon: (status: string) => ReactNode;
  /** `null` while the orders are being read; an `Error` when the read failed. */
  rows: OpenOrderRow[] | null | Error;
  /** Persist one field of one order. Resolve `false` (after reporting the
   *  reason) to have the cell revert. */
  onSave: (
    row: OpenOrderRow,
    field: OpenOrderField,
    value: number | string
  ) => Promise<boolean>;
  onRowsChange: (rows: OpenOrderRow[]) => void;
};

const QUANTITY_ACTION_TYPES: ReadonlySet<string> = new Set([
  "Increase",
  "Decrease"
]);
const DATE_ACTION_TYPES: ReadonlySet<string> = new Set(["Expedite", "Defer"]);

// The Due Date cell beside it already carries the year; the suggested date
// only needs to be told apart from it, and the drawer is narrow.
const SHORT_DATE = { month: "short", day: "numeric" } as const;

export function OpenOrdersGrid({
  title,
  documentHeader,
  quantityHeader,
  rows,
  renderStatusIcon,
  onSave,
  onRowsChange,
  ...handlers
}: OpenOrdersGridProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const formatQuantity = useQuantityFormatter();

  const saveCell = useCallback(
    async (
      accessorKey: string,
      value: unknown,
      row: OpenOrderRow
    ): Promise<PostgrestSingleResponse<unknown>> => {
      const field = accessorKey as OpenOrderField;
      const saved = await onSave(
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
    },
    [onSave]
  );

  const editableComponents = useMemo(
    () => ({
      quantity: EditableNumber<OpenOrderRow>(saveCell, { minValue: 0 }),
      dueDate: EditableDate<OpenOrderRow>(saveCell)
    }),
    [saveCell]
  );

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
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
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
        cell: ({ row }) => {
          const { action, suggestedQuantity } = row.original;
          if (!action) return null;
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
                  <span className="tabular-nums">
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
              <PlanningActionRowActions action={action} {...handlers} />
            </HStack>
          );
        }
      }
    ],
    [
      documentHeader,
      quantityHeader,
      renderStatusIcon,
      formatQuantity,
      locale,
      t,
      handlers.currentUserId,
      handlers.canUpdate,
      handlers.isBusy,
      handlers.onApply,
      handlers.onDismiss,
      handlers.onReopen,
      handlers.onAssignToMe
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
        />
      )}
    </div>
  );
}

/**
 * The one planning action to show on an order's row: MRP emits at most one
 * action per target document, but a dismissed one can coexist with a newer open
 * one — the open action wins.
 */
export function actionForOrder(
  actions: PlanningAction[],
  matches: (action: PlanningAction) => boolean
): PlanningAction | null {
  const mine = actions.filter(matches);
  return mine.find((a) => a.status === "Open") ?? mine[0] ?? null;
}
