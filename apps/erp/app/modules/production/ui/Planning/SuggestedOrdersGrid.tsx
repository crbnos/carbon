// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { LuCalendarClock, LuTrash } from "react-icons/lu";
import { EditableDate, EditableNumber } from "~/components/Editable";
import Grid from "~/components/Grid";
import { useQuantityFormatter } from "~/hooks";
import { planningOrderStart } from "~/modules/production/production.models";
import {
  ORDER_GRID_MAX_HEIGHT,
  QUANTITY_FIELD,
  SAVED,
  SectionTitle
} from "./PlanningOrderGridParts";
import {
  rescheduledFromToday,
  type SuggestedOrderDates,
  withDatesInStep
} from "./suggested-order-dates";

// The drawer's Suggested Orders / Suggested Jobs: orders that do not exist
// yet. A cell edit changes a draft held by the planning grid; nothing is
// written until the drawer's Order / Make button creates them.

/** A draft cell has nothing to persist: the grid's `onDataChange` is the save. */
const draftMutation = async () => SAVED;

type SuggestedOrder = SuggestedOrderDates & { quantity: number };

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
  /** Header of the "last day to act" column: a purchase is ordered by that
   *  day, a job is started by it. */
  orderByHeader: string;
  isDisabled?: boolean;
  /** Changes when the rows were re-read from the suggestions, so a cell
   *  editor left open cannot show one row's value on another. */
  resetKey?: number;
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
  resetKey,
  onChange,
  onAdd
}: SuggestedOrdersGridProps<O>) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const formatQuantity = useQuantityFormatter();

  const editableComponents = useMemo(
    () => ({
      quantity: EditableNumber<O>(draftMutation, QUANTITY_FIELD),
      dueDate: EditableDate<O>(draftMutation),
      startDate: EditableDate<O>(draftMutation)
    }),
    []
  );

  const onGridChange = useCallback(
    (next: O[]) => onChange(withDatesInStep(next, orders, leadTime, todayIso)),
    [onChange, orders, leadTime, todayIso]
  );

  const rescheduledDue = formatDate(
    parseDate(todayIso).add({ days: leadTime }).toString(),
    undefined,
    locale
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
        // date; red once it has passed.
        accessorKey: "startDate",
        header: orderByHeader,
        size: 172,
        cell: ({ row }) => {
          const orderBy = planningOrderStart(row.original, leadTime);
          if (!orderBy) return "—";
          const isLate = orderBy < todayIso;
          return (
            <span className="flex items-center gap-1">
              <span
                className={
                  isLate
                    ? "tabular-nums font-medium text-red-500"
                    : "tabular-nums"
                }
              >
                {formatDate(orderBy, undefined, locale)}
              </span>
              {isLate && !isDisabled && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={t`Reschedule from today`}
                      icon={<LuCalendarClock />}
                      onClick={(event) => {
                        // keep the click from opening the cell's editor
                        event.stopPropagation();
                        onChange(
                          orders.map((order, index) =>
                            index === row.index
                              ? rescheduledFromToday(order, leadTime, todayIso)
                              : order
                          )
                        );
                      }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <Trans>Reschedule from today, due {rescheduledDue}</Trans>
                  </TooltipContent>
                </Tooltip>
              )}
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
    rescheduledDue,
    isDisabled,
    orders,
    onChange,
    t
  ]);

  return (
    <div className="flex w-full flex-col gap-2">
      <SectionTitle action={titleAction}>{title}</SectionTitle>
      <Grid<O>
        key={resetKey}
        data={orders}
        columns={columns}
        canEdit={!isDisabled}
        editableComponents={editableComponents}
        onDataChange={onGridChange}
        onNewRow={!isDisabled ? onAdd : undefined}
        contained={false}
        withSimpleSorting={false}
        maxHeight={ORDER_GRID_MAX_HEIGHT}
      />
    </div>
  );
}
