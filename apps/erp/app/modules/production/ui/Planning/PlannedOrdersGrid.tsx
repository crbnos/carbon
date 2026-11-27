// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  HStack,
  Status,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { formatDate, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { LuLock } from "react-icons/lu";
import Grid from "~/components/Grid";
import { useQuantityFormatter } from "~/hooks";
import type { PlanningAction } from "~/modules/production/types";
import type { PlanningActionHandlers } from "./PlanningActionLines";
import {
  ActionSuggestion,
  ORDER_GRID_MAX_HEIGHT,
  OrderRowsPending,
  QUANTITY_FIELD,
  SectionTitle,
  useSavingEditors
} from "./PlanningOrderGridParts";

// The drawer's Planned Orders: the planned orders MRP holds for the item
// (Planned or Firm). A cell edit SAVES it and firms the order.

// A planned order holds something: 0 is a Cancel, not an edit.
const PLANNED_QUANTITY_FIELD = {
  ...QUANTITY_FIELD,
  minValue: INPUT_STEP.quantity
};

export type PlannedOrderRow = {
  /** The planned order's id, or the action's on a read-only fallback row. */
  id: string;
  status: "Planned" | "Firm" | "Converted" | null;
  quantity: number | null;
  dueDate: string | null;
  releaseDate: string | null;
  /** How MRP sized the order (`plannedOrder.quantityTrace`). */
  quantityTrace: unknown;
  /** A Planned order whose release date is inside the item's time fence:
   *  MRP keeps it as it is. */
  isFenceHeld: boolean;
  /** False on a read-only row: no permission, or no planned order behind it. */
  isEditable: boolean;
  /** The open (else dismissed) planning action that targets this order. */
  action: PlanningAction | null;
  suggestedQuantity: number | null;
};

export type PlannedOrderField = "quantity" | "dueDate";

type QuantityTrace = {
  policyName?: string | null;
  triggerValues?: { projectedStock?: number | null } | null;
  quantity?: number | null;
  scrapQuantity?: number | null;
  explosionQuantity?: number | null;
};

function readQuantityTrace(value: unknown): QuantityTrace | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as QuantityTrace;
}

/** The sizing of a planned order as one line: "Projected stock -3 → Fixed
 *  Reorder Quantity 5 → scrap +1 → explode 6". Null when MRP stored none. */
function useQuantityTraceLine() {
  const { t } = useLingui();
  const formatQuantity = useQuantityFormatter();
  return useCallback(
    (value: unknown): string | null => {
      const trace = readQuantityTrace(value);
      if (!trace) return null;
      const parts: string[] = [];
      const projected = trace.triggerValues?.projectedStock;
      if (typeof projected === "number") {
        const stock = formatQuantity(projected);
        parts.push(t`Projected stock ${stock}`);
      }
      if (typeof trace.quantity === "number") {
        const quantity = formatQuantity(trace.quantity);
        parts.push(
          trace.policyName ? `${trace.policyName} ${quantity}` : quantity
        );
      }
      if (typeof trace.scrapQuantity === "number" && trace.scrapQuantity > 0) {
        const scrap = formatQuantity(trace.scrapQuantity);
        parts.push(t`scrap +${scrap}`);
      }
      if (
        typeof trace.explosionQuantity === "number" &&
        trace.explosionQuantity > 0
      ) {
        const explode = formatQuantity(trace.explosionQuantity);
        parts.push(t`explode ${explode}`);
      }
      return parts.length > 0 ? parts.join(" → ") : null;
    },
    [formatQuantity, t]
  );
}

type PlannedOrdersGridProps = PlanningActionHandlers & {
  title: ReactNode;
  /** `null` while the orders are being read; an `Error` when the read failed. */
  rows: PlannedOrderRow[] | null | Error;
  /** Today on the location's calendar — a planned order due before it is late. */
  todayIso: string;
  /** Persist one field of one planned order. Resolve `false` (after
   *  reporting the reason, or when the planner said no) to revert the cell. */
  onSave: (
    row: PlannedOrderRow,
    field: PlannedOrderField,
    value: number | string
  ) => Promise<boolean>;
  onRowsChange: (rows: PlannedOrderRow[]) => void;
  /** Firm a Planned order, or give a Firm one back to MRP. */
  onToggleFirm: (row: PlannedOrderRow) => void;
  /** The order a Firm / Unfirm is in flight for. */
  firmingId: string | null;
  /** Bump to close every open editor and clear its error mark. */
  resetKey?: number;
};

/**
 * The planned orders MRP holds for the item: what the Suggested Jobs /
 * Suggested Orders above them will become. Like `OpenOrdersGrid`, a cell edit
 * SAVES (the edit firms the order); Firm / Unfirm decides whether MRP may
 * change the order on its next run.
 */
export function PlannedOrdersGrid({
  title,
  rows,
  todayIso,
  onSave,
  onRowsChange,
  onToggleFirm,
  firmingId,
  resetKey,
  ...handlers
}: PlannedOrdersGridProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const formatQuantity = useQuantityFormatter();
  const traceLine = useQuantityTraceLine();

  const editableComponents = useSavingEditors<
    PlannedOrderRow,
    PlannedOrderField
  >(onSave, PLANNED_QUANTITY_FIELD);

  // `handlers` is a rest object, new on every render, so the memo depends on
  // its members instead.
  const columns = useMemo<ColumnDef<PlannedOrderRow>[]>(
    () => [
      {
        id: "status",
        header: t`Status`,
        size: 200,
        cell: ({ row }) => {
          const { status, isFenceHeld } = row.original;
          if (!status) return null;
          return (
            <HStack spacing={1} className="flex-nowrap">
              <Status
                color={status === "Firm" ? "blue" : "gray"}
                className="shrink-0"
              >
                {status === "Firm" ? t`Firm` : t`Planned`}
              </Status>
              {isFenceHeld && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      // focusable: the tooltip is the only explanation
                      tabIndex={0}
                      className="shrink-0 gap-1"
                    >
                      <LuLock className="size-3" aria-hidden />
                      <Trans>Fence</Trans>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[320px] whitespace-normal">
                    <Trans>
                      Released inside the planning time fence: MRP keeps its
                      quantity and dates.
                    </Trans>
                  </TooltipContent>
                </Tooltip>
              )}
            </HStack>
          );
        }
      },
      {
        accessorKey: "releaseDate",
        header: t`Release Date`,
        size: 130,
        cell: ({ row }) => {
          const { releaseDate } = row.original;
          if (!releaseDate) return "—";
          return (
            <span
              className={
                // the day to release it has passed
                releaseDate < todayIso
                  ? "whitespace-nowrap tabular-nums font-medium text-red-500"
                  : "whitespace-nowrap tabular-nums"
              }
            >
              {formatDate(releaseDate, undefined, locale)}
            </span>
          );
        }
      },
      {
        accessorKey: "dueDate",
        header: t`Due Date`,
        size: 130,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original.dueDate
              ? formatDate(row.original.dueDate, undefined, locale)
              : "—"}
          </span>
        )
      },
      {
        accessorKey: "quantity",
        header: t`Quantity`,
        size: 110,
        cell: ({ row }) => {
          const { quantity, quantityTrace } = row.original;
          if (quantity === null) return "—";
          const value = (
            <span className="tabular-nums">{formatQuantity(quantity)}</span>
          );
          // The trace explains MRP's number. Once a planner edits the
          // quantity, it would explain a number no longer shown.
          const tracedQuantity = readQuantityTrace(quantityTrace)?.quantity;
          const line =
            typeof tracedQuantity === "number" &&
            tracedQuantity !== Number(quantity)
              ? null
              : traceLine(quantityTrace);
          if (!line) return value;
          return (
            <Tooltip>
              <TooltipTrigger asChild>{value}</TooltipTrigger>
              <TooltipContent className="max-w-[360px] whitespace-normal">
                {line}
              </TooltipContent>
            </Tooltip>
          );
        }
      },
      {
        id: "firm",
        header: "",
        size: 96,
        cell: ({ row }) => {
          const { status } = row.original;
          if (!row.original.isEditable) return null;
          if (status !== "Planned" && status !== "Firm") return null;
          return (
            <Button
              size="sm"
              variant="secondary"
              isLoading={firmingId === row.original.id}
              isDisabled={firmingId !== null || handlers.isBusy}
              onClick={(event) => {
                // keep the click from opening a cell's editor
                event.stopPropagation();
                onToggleFirm(row.original);
              }}
            >
              {status === "Firm" ? t`Unfirm` : t`Firm`}
            </Button>
          );
        }
      },
      {
        id: "suggestion",
        header: t`Suggestion`,
        size: 300,
        cell: ({ row }) => {
          const { action, suggestedQuantity } = row.original;
          if (!action) return null;
          return (
            <ActionSuggestion
              action={action}
              suggestedQuantity={suggestedQuantity}
              todayIso={todayIso}
              handlers={handlers}
            />
          );
        }
      }
    ],
    // oxlint-disable-next-line react/exhaustive-deps -- the handler members listed ARE `handlers`
    [
      formatQuantity,
      traceLine,
      locale,
      todayIso,
      firmingId,
      onToggleFirm,
      t,
      handlers.currentUserId,
      handlers.canUpdate,
      handlers.isBusy,
      handlers.onApply,
      handlers.onDismiss,
      handlers.onReopen,
      handlers.onAssignToMe,
      handlers.canApply
    ]
  );

  const isRowEditable = useCallback(
    (row: PlannedOrderRow) => row.isEditable,
    []
  );

  // An item with no planned orders shows nothing; a failed read says so.
  if (Array.isArray(rows) && rows.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-2">
      <SectionTitle>{title}</SectionTitle>
      {!Array.isArray(rows) ? (
        <OrderRowsPending rows={rows} />
      ) : (
        <Grid<PlannedOrderRow>
          key={resetKey}
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
