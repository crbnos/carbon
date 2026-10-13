// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast } from "@carbon/react";
import { createElement, useCallback, useEffect, useMemo } from "react";
import { Link, useFetcher } from "react-router";
import type { PlanningAction } from "~/modules/production";
import { actionsOfTypes } from "~/modules/production";
import {
  type FenceRow,
  useTimeFenceOverrides
} from "~/modules/production/ui/Planning/PlanningFence";
import { planningRowKey } from "~/modules/production/ui/Planning/planning-action-scope";
import { actionsInsideFence } from "~/modules/production/ui/Planning/planning-fence";
import { isStaleRelease } from "~/modules/production/ui/Planning/planning-review";
import { path } from "~/utils/path";

/**
 * The planning grids' MRP worklist state, shared by the production and
 * purchasing tables: the submit fetcher and its toast, each row's actions
 * inside its time fence, and the ones the Actions-column filter shows.
 */
export function usePlanningActions({
  data,
  planningActions,
  actionTypes,
  locationId,
  updatePath,
  currentUserId,
  canUpdate
}: {
  data: (FenceRow & { planningSegmentId?: string | null })[];
  planningActions: PlanningAction[];
  /** The Actions-column filter; null shows every type. */
  actionTypes: string[] | null;
  locationId: string;
  /** The planning route's update action (`planning.update`). */
  updatePath: string;
  currentUserId: string;
  canUpdate: boolean;
}) {
  const actionsFetcher = useFetcher<{
    success?: boolean;
    message?: string;
    /** The Draft project stock transfers an applied Transfer created. */
    transfers?: { id: string; projectStockTransferId: string }[];
  }>();
  const isActionsBusy = actionsFetcher.state !== "idle";

  useEffect(() => {
    if (actionsFetcher.state !== "idle" || !actionsFetcher.data?.message)
      return;
    const { message, success, transfers } = actionsFetcher.data;
    // An applied Transfer leaves the worklist; the toast links its transfer.
    const content =
      transfers && transfers.length > 0
        ? createElement(
            "div",
            { className: "flex flex-col gap-1" },
            createElement("span", null, message),
            createElement(
              "span",
              { className: "flex flex-wrap gap-2 text-xs" },
              ...transfers.map((transfer) =>
                createElement(
                  Link,
                  {
                    key: transfer.id,
                    to: path.to.projectStockTransfer(transfer.id),
                    className: "underline underline-offset-2 hover:opacity-80"
                  },
                  transfer.projectStockTransferId
                )
              )
            )
          )
        : message;
    if (success) {
      toast.success(content, transfers?.length ? { duration: 8000 } : {});
    } else {
      toast.error(content);
    }
  }, [actionsFetcher.state, actionsFetcher.data]);

  // Keyed by the row (`planningRowKey`): the grid has a row per item and
  // netting segment, and each row holds its own segment's actions only.
  const actionsByRowKey = useMemo(() => {
    const map = new Map<string, PlanningAction[]>();
    for (const action of planningActions) {
      // a Release whose order moved on since MRP ran no longer applies
      if (isStaleRelease(action)) continue;
      const key = planningRowKey({
        id: action.itemId,
        planningSegmentId: action.planningSegmentId
      });
      const list = map.get(key);
      if (list) list.push(action);
      else map.set(key, [action]);
    }
    return map;
  }, [planningActions]);

  // A row surfaces only what falls on or before its fence date (today + the
  // item's planning horizon). Moving a row's fence here is page state: it
  // re-filters what is already loaded and never touches the item.
  const timeFence = useTimeFenceOverrides();

  const fencedActionsByRowKey = useMemo(() => {
    const map = new Map<string, PlanningAction[]>();
    for (const row of data) {
      const key = planningRowKey(row);
      const actions = actionsByRowKey.get(key);
      if (!actions) continue;
      const fenced = actionsInsideFence(actions, timeFence.fenceDateFor(row));
      if (fenced.length > 0) map.set(key, fenced);
    }
    return map;
  }, [data, actionsByRowKey, timeFence]);

  // What the GRID shows and acts on: under the Actions-column filter, only
  // the filtered types. The order drawer keeps every fenced action — it lists
  // the item's open orders, and one shown without its pending suggestion
  // would read as "nothing to do".
  const visibleActionsByRowKey = useMemo(() => {
    if (!actionTypes) return fencedActionsByRowKey;
    const map = new Map<string, PlanningAction[]>();
    for (const [key, actions] of fencedActionsByRowKey) {
      const visible = actionsOfTypes(actions, actionTypes);
      if (visible.length > 0) map.set(key, visible);
    }
    return map;
  }, [fencedActionsByRowKey, actionTypes]);

  // ONE batched request per click: the route derives each row's behaviour
  // from its persisted type, and a fetcher holds a single in-flight submission.
  const submitActions = useCallback(
    (payload: Record<string, unknown>) => {
      actionsFetcher.submit(JSON.stringify({ locationId, ...payload }), {
        method: "post",
        action: updatePath,
        encType: "application/json"
      });
    },
    [actionsFetcher, locationId, updatePath]
  );

  // What the expanded action lines and the order drawer's open-orders grid
  // act through: the same props `PlanningActionLines` takes.
  const actionHandlers = useMemo(
    () => ({
      currentUserId,
      canUpdate,
      isBusy: isActionsBusy,
      onApply: (ids: string[]) =>
        submitActions({ action: "apply", planningActionIds: ids }),
      onDismiss: (ids: string[]) =>
        submitActions({ action: "dismiss", planningActionIds: ids }),
      onReopen: (ids: string[]) =>
        submitActions({ action: "reopen", planningActionIds: ids }),
      onAssignToMe: (ids: string[]) =>
        submitActions({
          action: "assign",
          planningActionIds: ids,
          assignee: currentUserId
        }),
      // An empty assignee unassigns.
      onAssign: (ids: string[], assignee: string) =>
        submitActions({ action: "assign", planningActionIds: ids, assignee })
    }),
    [currentUserId, canUpdate, isActionsBusy, submitActions]
  );

  return {
    actionHandlers,
    isActionsBusy,
    timeFence,
    actionsByRowKey,
    fencedActionsByRowKey,
    visibleActionsByRowKey,
    submitActions
  };
}
