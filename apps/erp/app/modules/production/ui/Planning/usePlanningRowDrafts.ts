// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { getLogger } from "@carbon/logger";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { PLANNING_DRAWER_PARAM } from "~/modules/production/production.models";
import {
  type DrawerPlannedOrder,
  getRowPlannedOrders
} from "~/modules/production/production.utils";
import { withoutRowDraft } from "./planned-orders-from-actions";
import { planningRowKey } from "./planning-action-scope";

const logger = getLogger("erp", "production", "planning-row-drafts");

type DraftRow = { id: string; planningSegmentId?: string | null };

/**
 * The planning grids' page state for the order drawer, shared by the
 * production and purchasing tables, keyed by row (`planningRowKey`):
 *
 * - the drawer's draft orders (`ordersMap`). They are dropped when the
 *   page's scope changes (location, filters, search, sort), when MRP
 *   recalculates or re-plans, and when an order is placed — NOT on every
 *   reload of the loader: Apply, Dismiss and Assign inside the drawer
 *   revalidate it, and that used to wipe the planner's edits;
 * - the planned orders each drawer read (`plannedOrdersByRowKey`), which the
 *   row's suggested orders stand for (common segment only);
 * - `draftVersion`, bumped on every drop, which closes a suggested-order cell
 *   editor left open in the drawer;
 * - the planned orders a bulk Make / Order reads for the rows it sizes
 *   itself, so a bulk order converts by id as the drawer's does.
 */
export function usePlanningRowDrafts<O>(args: {
  orderType: "Make" | "Buy";
  locationId: string;
  companyId: string;
  /**
   * What an Apply that changed planned orders drops (MRP re-ran for the
   * company). `everyRow`: a Make planned order explodes to its components,
   * which may be other rows of the grid. `appliedRows`: a Buy planned order
   * explodes nothing, so only the applied rows moved.
   */
  replanDrops: "everyRow" | "appliedRows";
}) {
  const { orderType, locationId, companyId, replanDrops } = args;
  const { t } = useLingui();
  const { carbon } = useCarbon();

  const [ordersMap, setOrdersMap] = useState<Record<string, O[]>>({});
  const [plannedOrdersByRowKey, setPlannedOrdersByRowKey] = useState<
    Record<string, DrawerPlannedOrder[]>
  >({});
  const [draftVersion, setDraftVersion] = useState(0);

  // The open drawer is in the address too, and is not a change of scope.
  const [searchParams] = useSearchParams();
  const pageScope = useMemo(() => {
    const scope = new URLSearchParams(searchParams);
    scope.delete(PLANNING_DRAWER_PARAM);
    return scope.toString();
  }, [searchParams]);
  useEffect(() => {
    setOrdersMap({});
  }, [pageScope]);

  const setOrders = useCallback((item: DraftRow, orders: O[]) => {
    if (item.id) {
      setOrdersMap((prev) => ({ ...prev, [planningRowKey(item)]: orders }));
    }
  }, []);

  const onPlannedOrdersLoaded = useCallback(
    (item: DraftRow, orders: DrawerPlannedOrder[]) => {
      if (item.id) {
        setPlannedOrdersByRowKey((prev) => ({
          ...prev,
          [planningRowKey(item)]: orders
        }));
      }
    },
    []
  );

  // The row's draft is stale (an order placed, a planned order changed): drop
  // it so the drawer re-seeds, and its planned orders, which the drawer reads
  // again.
  const dropOrders = useCallback((item: DraftRow) => {
    if (!item.id) return;
    setOrdersMap((prev) => withoutRowDraft(prev, item));
    setPlannedOrdersByRowKey((prev) => withoutRowDraft(prev, item));
    setDraftVersion((version) => version + 1);
  }, []);

  // MRP re-ran for the company: every draft goes, as after Recalculate.
  const dropAllDrafts = useCallback(() => {
    setOrdersMap({});
    setPlannedOrdersByRowKey({});
    setDraftVersion((version) => version + 1);
  }, []);

  // Recalculate finished: the drawer re-seeds from the new run's actions and
  // planned orders.
  const clearDrafts = useCallback(() => {
    setOrdersMap({});
    setPlannedOrdersByRowKey({});
  }, []);

  // A bulk order answered: the drafts it leaves (the refused orders), and the
  // planned orders read again, since the new documents converted some.
  const replaceDrafts = useCallback((drafts: Record<string, O[]>) => {
    setOrdersMap(drafts);
    setPlannedOrdersByRowKey({});
  }, []);

  // The horizon is per item, so every segment row of the item re-seeds.
  const dropItemDrafts = useCallback((itemId: string) => {
    setOrdersMap((prev) => {
      const kept = Object.entries(prev).filter(
        ([key]) => key.split("\u001f")[0] !== itemId
      );
      if (kept.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(kept);
    });
  }, []);

  const onRowsReplanned = useCallback(
    (rows: { id: string; planningSegmentId: string | null }[]) => {
      if (replanDrops === "everyRow") {
        if (rows.length > 0) dropAllDrafts();
        return;
      }
      for (const row of rows) dropOrders(row);
    },
    [replanDrops, dropAllDrafts, dropOrders]
  );

  // One read at a time: the ref refuses a second click before the busy state
  // has rendered.
  const isReadingRef = useRef(false);
  const [isReadingPlannedOrders, setIsReadingPlannedOrders] = useState(false);
  const isReading = useCallback(() => isReadingRef.current, []);

  /**
   * The planned orders of the rows a bulk order sizes itself (rows never
   * opened in the drawer; only the common segment has planned orders), by
   * item. Null when none is sized here, or when they could not be read: the
   * rows are then sized from their actions alone, and the order placed
   * converts the week's planned orders by quantity, which the planner is
   * told.
   */
  const readPlannedOrders = useCallback(
    async (
      rows: DraftRow[]
    ): Promise<Map<string, DrawerPlannedOrder[]> | null> => {
      const itemIds = rows
        .filter(
          (row) =>
            row.id &&
            !row.planningSegmentId &&
            !(planningRowKey(row) in ordersMap)
        )
        .map((row) => row.id);
      if (itemIds.length === 0) return null;
      const sizedWithout = (error: unknown) => {
        logger.warning("Failed to read the planned orders for a bulk order", {
          orderType,
          locationId,
          itemCount: itemIds.length,
          error
        });
        toast.error(
          t`Could not read the planned orders. The orders were sized from the planning actions instead.`
        );
        return null;
      };
      if (!carbon) return sizedWithout("No database client");
      isReadingRef.current = true;
      setIsReadingPlannedOrders(true);
      try {
        const read = await getRowPlannedOrders(carbon, {
          companyId,
          locationId,
          orderType,
          itemIds
        });
        if (read.error) return sizedWithout(read.error);
        const byItem = new Map<string, DrawerPlannedOrder[]>();
        for (const order of read.data) {
          const list = byItem.get(order.itemId);
          if (list) list.push(order);
          else byItem.set(order.itemId, [order]);
        }
        return byItem;
      } catch (error) {
        return sizedWithout(error);
      } finally {
        isReadingRef.current = false;
        setIsReadingPlannedOrders(false);
      }
    },
    [carbon, companyId, locationId, orderType, ordersMap, t]
  );

  return {
    ordersMap,
    setOrders,
    plannedOrdersByRowKey,
    onPlannedOrdersLoaded,
    draftVersion,
    dropOrders,
    dropAllDrafts,
    clearDrafts,
    replaceDrafts,
    dropItemDrafts,
    onRowsReplanned,
    isReading,
    isReadingPlannedOrders,
    readPlannedOrders
  };
}
