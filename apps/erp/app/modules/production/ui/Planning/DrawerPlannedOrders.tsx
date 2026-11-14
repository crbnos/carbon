// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { useRevalidator } from "@carbon/query";
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
import { useUser } from "~/hooks";
import {
  type DrawerPlannedOrder,
  getDrawerPlannedOrders,
  getPlanningTimeFenceDays
} from "~/modules/production/production.utils";
import type { PlanningAction } from "~/modules/production/types";
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
};

/** What a planning route answers: a service result (`{ data, error }`,
 *  production) or `{ success, message }` (purchasing). */
type PlannedOrderChangeResult = {
  success?: boolean;
  message?: string;
  error?: { message: string } | null;
};

/**
 * The drawer's Planned Orders section: the item's Planned and Firm planned
 * orders at the location, read with the user's client as the open jobs and
 * PO lines are. Firm / Unfirm and a cell edit post to `planning.update`. An
 * edit of a Planned order firms it, so the drawer asks first. Each change
 * re-plans on the server, so a successful one reloads the page's data: the
 * item's actions and the row's Make / Order quantity.
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
  onOrdersLoaded
}: DrawerPlannedOrdersProps) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const { revalidate } = useRevalidator();
  const isCommonSegment = !planningSegmentId;

  const [orders, setOrders] = useState<DrawerPlannedOrder[] | null | Error>(
    null
  );
  const [fenceDays, setFenceDays] = useState(0);
  // Bumped after a change here, to read the orders again.
  const [version, setVersion] = useState(0);
  // The latest callback, so a new function from the parent re-reads nothing.
  const onOrdersLoadedRef = useRef(onOrdersLoaded);
  onOrdersLoadedRef.current = onOrdersLoaded;

  const plannedOrderActions = useMemo(
    () => actions.filter((action) => action.plannedOrderId),
    [actions]
  );
  // Re-read when the item's actions change: applying one edits its order.
  const actionsKey = plannedOrderActions
    .map((a) => `${a.id}:${a.status}`)
    .join(",");

  // Only while open: the drawer stays mounted on its last item so it can
  // slide out.
  // biome-ignore lint/correctness/useExhaustiveDependencies: actionsKey, version and refreshKey are re-read triggers
  useEffect(() => {
    if (!isOpen || !carbon || !itemId || !isCommonSegment) return;
    let isCurrent = true;

    (async () => {
      const args = { companyId: company.id, itemId, locationId };
      const [read, fence] = await Promise.all([
        getDrawerPlannedOrders(carbon, { ...args, orderType }),
        getPlanningTimeFenceDays(carbon, args)
      ]);
      if (!isCurrent) return;
      if (read.error) {
        setOrders(new Error(read.error.message));
        return;
      }
      // a fence that cannot be read only hides the marker
      setFenceDays(fence.data ?? 0);
      setOrders(read.data ?? []);
      onOrdersLoadedRef.current?.(read.data ?? []);
    })();

    return () => {
      isCurrent = false;
    };
  }, [
    isOpen,
    carbon,
    company.id,
    itemId,
    locationId,
    orderType,
    isCommonSegment,
    actionsKey,
    version,
    refreshKey
  ]);

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

  const onRowsChange = useCallback((next: PlannedOrderRow[]) => {
    setOrders((previous) =>
      Array.isArray(previous)
        ? previous.map((order) => {
            const row = next.find((r) => r.id === order.id);
            return row && row.quantity !== null && row.dueDate !== null
              ? { ...order, quantity: row.quantity, dueDate: row.dueDate }
              : order;
          })
        : previous
    );
  }, []);

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
          // A plain fetch bypasses the router, and the server re-planned:
          // reload the actions and the grid row behind the drawer.
          void revalidate();
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
    [locationId, revalidate, t, updatePath]
  );

  // ── The question an edit of a Planned order asks first ───────────────────
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
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
      setVersion((v) => v + 1);
      return true;
    },
    [askToKeepNumbers, post]
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
      setVersion((v) => v + 1);
    },
    [post, t]
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
