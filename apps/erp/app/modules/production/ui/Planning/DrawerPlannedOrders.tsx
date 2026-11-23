// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RefreshRate, useLoaderQuery, useRevalidator } from "@carbon/query";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  toast
} from "@carbon/react";
import { isPlannedOrderHeld } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DrawerPlannedOrder } from "~/modules/production/production.utils";
import type { PlanningAction } from "~/modules/production/types";
import type { loader as plannedOrdersLoader } from "~/routes/api+/production.planned-orders";
import { path } from "~/utils/path";
import type { PlanningActionHandlers } from "./PlanningActionLines";
import {
  actionForOrder,
  type PlannedOrderField,
  type PlannedOrderRow,
  PlannedOrdersGrid
} from "./PlanningOrderGrids";

type DrawerPlannedOrdersProps = {
  title: ReactNode;
  isOpen: boolean;
  itemId: string;
  locationId: string;
  /** The drawer row's netting segment: planned orders exist only in the
   *  common one (`''`). */
  planningSegmentId: string | null | undefined;
  orderType: "Make" | "Buy";
  /** The planning route's update action (`planning.update`). */
  updatePath: string;
  /** Today on the location's calendar. */
  todayIso: string;
  /** The item's change actions inside the fence. The ones on a planned order
   *  are shown on its row. */
  actions: PlanningAction[];
  actionHandlers: PlanningActionHandlers;
  /** Bumped by the drawer to read the orders again (after an order is
   *  placed, which converts planned orders). */
  refreshKey?: number;
  /** Told the orders on every read: the drawer's suggested orders stand for
   *  them (`productionOrdersFromActions` / `plannedOrdersFromActions`). */
  onOrdersLoaded?: (orders: DrawerPlannedOrder[]) => void;
  /** Told after a firm, unfirm or edit here: the server re-planned, so the
   *  drawer's suggested orders are stale and must be built again. */
  onReplanned?: () => void;
};

/** What a planning route answers: a service result (`{ data, error }`,
 *  production) or `{ success, message }` (purchasing). */
type PlannedOrderChangeResult = {
  success?: boolean;
  message?: string;
  error?: { message: string } | null;
};

/**
 * The item's planned orders and time fence at the location, read through
 * `api+/production.planned-orders`. Any action through the router marks the
 * read stale (the root invalidation middleware), so it follows an Apply and
 * an order placed. `refreshKey` reads again after a change the router does
 * not see. Each answer is passed to `onLoaded`.
 */
function useDrawerPlannedOrders(args: {
  url: string | null;
  refreshKey: number;
  onLoaded?: (orders: DrawerPlannedOrder[]) => void;
}) {
  const { url, refreshKey } = args;
  const query = useLoaderQuery<typeof plannedOrdersLoader>(url, {
    staleTime: RefreshRate.High
  });
  const { refetch } = query;
  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === lastRefreshKey.current) return;
    lastRefreshKey.current = refreshKey;
    if (url) void refetch();
  }, [refreshKey, url, refetch]);

  // The latest callback, so a new function from the parent re-reads nothing.
  const onLoadedRef = useRef(args.onLoaded);
  onLoadedRef.current = args.onLoaded;
  useEffect(() => {
    if (query.data) onLoadedRef.current?.(query.data.orders);
  }, [query.data]);

  return query;
}

/**
 * The drawer's Planned Orders section: the item's Planned and Firm planned
 * orders at the location, read with the user's permissions as the open jobs
 * and PO lines are. Firm / Unfirm and a cell edit post to `planning.update`. An
 * edit of a Planned order firms it, so the drawer asks first. Each change
 * re-plans on the server, so a successful one reads the orders again, tells
 * the drawer (`onReplanned`) and reloads the page's data: the item's actions
 * and the row's Make / Order quantity.
 */
export function DrawerPlannedOrders({
  title,
  isOpen,
  itemId,
  locationId,
  planningSegmentId,
  orderType,
  updatePath,
  todayIso,
  actions,
  actionHandlers,
  refreshKey = 0,
  onOrdersLoaded,
  onReplanned
}: DrawerPlannedOrdersProps) {
  const { t } = useLingui();
  const { revalidate } = useRevalidator();
  const isCommonSegment = !planningSegmentId;

  // Only while open: the drawer stays mounted on its last item so it can
  // slide out.
  const query = useDrawerPlannedOrders({
    url:
      isOpen && itemId && isCommonSegment
        ? path.to.api.plannedOrders({ itemId, locationId, orderType })
        : null,
    refreshKey,
    onLoaded: onOrdersLoaded
  });
  const fenceDays = query.data?.fenceDays ?? 0;

  // A cell's saved edit, shown until the read that follows it lands. Kept
  // against the answer it edited, so a newer answer replaces it.
  const [edits, setEdits] = useState<{
    of: unknown;
    byId: Map<string, { quantity: number; dueDate: string }>;
  } | null>(null);

  const orders = useMemo<DrawerPlannedOrder[] | null | Error>(() => {
    if (query.error) {
      return query.error instanceof Error
        ? query.error
        : new Error(String(query.error));
    }
    if (!query.data) return null;
    const byId = edits?.of === query.data ? edits.byId : null;
    if (!byId) return query.data.orders;
    return query.data.orders.map((order) => {
      const edit = byId.get(order.id);
      return edit ? { ...order, ...edit } : order;
    });
  }, [query.data, query.error, edits]);

  const plannedOrderActions = useMemo(
    () => actions.filter((action) => action.plannedOrderId),
    [actions]
  );

  const rows = useMemo<PlannedOrderRow[] | null | Error>(() => {
    if (!Array.isArray(orders)) return orders;
    const result: PlannedOrderRow[] = orders.map((order) => {
      const action = actionForOrder(
        plannedOrderActions,
        (a) => a.plannedOrderId === order.id
      );
      return {
        id: order.id,
        status: order.status,
        quantity: Number(order.quantity),
        dueDate: order.dueDate,
        releaseDate: order.releaseDate,
        quantityTrace: order.quantityTrace,
        // held by the fence alone: a Firm order shows its own status
        isFenceHeld:
          order.status === "Planned" &&
          isPlannedOrderHeld(order, fenceDays, todayIso),
        isEditable: actionHandlers.canUpdate,
        action,
        suggestedQuantity: action ? Number(action.suggestedQuantity) : null
      };
    });

    // An action whose planned order is not in the list (converted or
    // deleted since MRP ran) still shows, read-only, as the open orders do.
    for (const action of plannedOrderActions) {
      if (result.some((row) => row.action?.id === action.id)) continue;
      result.push({
        id: action.id,
        status: action.plannedOrderStatus ?? null,
        quantity: null,
        dueDate: null,
        releaseDate: null,
        quantityTrace: null,
        isFenceHeld: false,
        isEditable: false,
        action,
        suggestedQuantity: Number(action.suggestedQuantity)
      });
    }
    return result;
  }, [
    orders,
    fenceDays,
    todayIso,
    plannedOrderActions,
    actionHandlers.canUpdate
  ]);

  const answerData = query.data;
  const onRowsChange = useCallback(
    (next: PlannedOrderRow[]) => {
      if (!answerData) return;
      const byId = new Map<string, { quantity: number; dueDate: string }>();
      for (const row of next) {
        if (row.quantity === null || row.dueDate === null) continue;
        byId.set(row.id, { quantity: row.quantity, dueDate: row.dueDate });
      }
      setEdits({ of: answerData, byId });
    },
    [answerData]
  );

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<string | null> => {
      try {
        const response = await fetch(updatePath, {
          method: "post",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locationId, ...body })
        });
        const result = (await response
          .json()
          .catch(() => null)) as PlannedOrderChangeResult | null;
        if (response.ok && !result?.error && result?.success !== false) {
          return null;
        }
        return (
          result?.error?.message ??
          result?.message ??
          t`Failed to update the planned order`
        );
      } catch {
        return t`Failed to update the planned order`;
      }
    },
    [locationId, t, updatePath]
  );

  // The server re-planned before it answered. A plain fetch bypasses the
  // router's invalidation, so read the orders again here, tell the drawer its
  // suggestions are stale, and reload the actions and the grid row behind it.
  const { refetch } = query;
  const afterReplan = useCallback(() => {
    void refetch();
    onReplanned?.();
    void revalidate();
  }, [refetch, onReplanned, revalidate]);

  // ── The question an edit of a Planned order asks first ───────────────────
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  // Bumped when the planner declines: the grid remounts on the unchanged
  // rows, so the cell neither keeps the typed value nor reads as failed.
  const [gridResetKey, setGridResetKey] = useState(0);
  const confirmAnswer = useRef<((keep: boolean) => void) | null>(null);
  const askToKeepNumbers = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        confirmAnswer.current = resolve;
        setIsConfirmOpen(true);
      }),
    []
  );
  const answer = useCallback((keep: boolean) => {
    confirmAnswer.current?.(keep);
    confirmAnswer.current = null;
    setIsConfirmOpen(false);
  }, []);

  const onSave = useCallback(
    async (
      row: PlannedOrderRow,
      field: PlannedOrderField,
      value: number | string
    ) => {
      // the edit firms the order: say so once, before a Planned one changes
      if (row.status === "Planned" && !(await askToKeepNumbers())) {
        setGridResetKey((key) => key + 1);
        return false;
      }
      const failure = await post({
        action: "updatePlannedOrder",
        id: row.id,
        [field]: value
      });
      if (failure) {
        toast.error(failure);
        return false;
      }
      // the order is Firm now, and a new due date moved its release date
      afterReplan();
      return true;
    },
    [askToKeepNumbers, post, afterReplan]
  );

  const [firmingId, setFirmingId] = useState<string | null>(null);
  const onToggleFirm = useCallback(
    async (row: PlannedOrderRow) => {
      setFirmingId(row.id);
      const isFirm = row.status === "Firm";
      const failure = await post({
        action: isFirm ? "unfirmPlannedOrder" : "firmPlannedOrder",
        id: row.id
      });
      setFirmingId(null);
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success(
        isFirm ? t`Planned order returned to MRP` : t`Planned order firmed`
      );
      afterReplan();
    },
    [post, t, afterReplan]
  );

  if (!isCommonSegment) return null;

  return (
    <>
      <PlannedOrdersGrid
        title={title}
        rows={rows}
        todayIso={todayIso}
        onSave={onSave}
        onRowsChange={onRowsChange}
        onToggleFirm={onToggleFirm}
        firmingId={firmingId}
        resetKey={gridResetKey}
        {...actionHandlers}
      />
      <Modal
        open={isConfirmOpen}
        onOpenChange={(open) => {
          if (!open) answer(false);
        }}
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <Trans>Keep your numbers through plan updates?</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Saving this change firms the planned order. MRP then keeps its
                quantity and dates, and raises a planning action when it
                disagrees. Unfirm gives the order back to MRP.
              </Trans>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => answer(false)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button onClick={() => answer(true)}>
              <Trans>Keep my numbers</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
