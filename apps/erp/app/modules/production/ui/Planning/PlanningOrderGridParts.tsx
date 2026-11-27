// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { HStack, Skeleton } from "@carbon/react";
import { formatDate, INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import {
  EditableDate,
  EditableNumber,
  useStableEditableComponents
} from "~/components/Editable";
import { useAfterFirstPaint, useQuantityFormatter } from "~/hooks";
import type { PlanningAction } from "~/modules/production/types";
import type { PlanningPurchaseOrder } from "./planning-review";
import { isPlanningActionLate } from "./planning-review";
import type { PlanningActionHandlers } from "./PlanningActionLines";
import {
  PlanningActionRowActions,
  PlanningActionTypeWithReason
} from "./PlanningActionLines";

// What the tables of the planning order drawer share. They look alike and
// save DIFFERENTLY, which is why they are separate tables and not one list:
//
//   SuggestedOrdersGrid — orders that do not exist yet. Editing a cell changes
//     a draft held by the planning grid; nothing is written until the drawer's
//     Order / Make button creates them.
//   OpenOrdersGrid — purchase order lines / jobs that already exist. Editing a
//     cell SAVES it (optimistic, reverted on failure), the way a count line or
//     a Properties field does. Rows a status has locked are plain text.
//   PlannedOrdersGrid — the planned orders MRP holds for the item (Planned or
//     Firm). Editing a cell SAVES it and firms the order.
//
// One list with both kinds hid that difference: an edit to an existing order
// sat unsaved until Order was pressed, and was dropped by Close.

export const SAVED = {
  success: true,
  data: null,
  error: null,
  count: null,
  status: 200,
  statusText: "OK"
} as const;

/** An editable quantity commits `parse(format(x))` on blur, so it needs the
 *  quantity kind's digits and step — Intl's default would round to three. */
export const QUANTITY_FIELD = {
  minValue: 0,
  formatOptions: INPUT_FORMAT.quantity,
  step: INPUT_STEP.quantity
};

// About eight orders tall. A part can have hundreds of open orders; past this
// the grid scrolls inside itself and renders only the rows in view. That grid
// lays its columns out fixed, so each column's `size` IS its width.
export const ORDER_GRID_MAX_HEIGHT = 400;

export function SectionTitle({
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

/** A saved-orders grid before it has rows: placeholders while the orders are
 *  read (`null`), a message when the read failed. */
export function OrderRowsPending({ rows }: { rows: null | Error }) {
  if (rows === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  return (
    <span className="text-sm text-muted-foreground">
      <Trans>
        These orders could not be loaded. Close and reopen to try again.
      </Trans>
    </span>
  );
}

/**
 * The quantity and due date editors of a grid whose cell edit SAVES. They
 * keep their identity for the life of the drawer: each `EditableNumber` /
 * `EditableDate` call returns a NEW component, so rebuilding them remounts
 * the open editor and drops what the planner is typing (Tab carries the edit
 * into the next cell while the previous save is in flight, and the caller's
 * `onSave` changes when that save revalidates). They read the latest
 * `onSave` (`useStableEditableComponents`). `onSave` resolving `false` reverts
 * the cell.
 */
export function useSavingEditors<R extends object, F extends string>(
  onSave: (row: R, field: F, value: number | string) => Promise<boolean>,
  quantityField: typeof QUANTITY_FIELD = QUANTITY_FIELD
) {
  return useStableEditableComponents(
    (latest) => {
      const saveCell = async (
        accessorKey: string,
        value: unknown,
        row: R
      ): Promise<PostgrestSingleResponse<unknown>> => {
        const field = accessorKey as F;
        const saved = await latest.current.onSave(
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
        quantity: EditableNumber<R>(saveCell, quantityField),
        dueDate: EditableDate<R>(saveCell)
      };
    },
    { onSave }
  );
}

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

/** What MRP suggests for one order, on that order's row: the type, the value
 *  it would set (the reason is behind the type's tooltip), and the one button
 *  that acts on it. */
export function ActionSuggestion({
  action,
  suggestedQuantity,
  todayIso,
  purchaseOrder,
  handlers
}: {
  action: PlanningAction;
  suggestedQuantity: number | null;
  todayIso: string;
  purchaseOrder?: PlanningPurchaseOrder | null;
  handlers: PlanningActionHandlers;
}) {
  const { locale } = useLocale();
  const formatQuantity = useQuantityFormatter();
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
