// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast } from "@carbon/react";
import { useCallback, useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import type { PlanningAction } from "~/modules/production";
import { actionsOfTypes } from "~/modules/production";
import {
  type FenceRow,
  useTimeFenceOverrides
} from "~/modules/production/ui/Planning/PlanningFence";
import { actionsInsideFence } from "~/modules/production/ui/Planning/planning-fence";

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
  data: FenceRow[];
  planningActions: PlanningAction[];
  /** The Actions-column filter; null shows every type. */
  actionTypes: string[] | null;
  locationId: string;
  /** The planning route's update action (`planning.update`). */
  updatePath: string;
  currentUserId: string;
  canUpdate: boolean;
}) {
  const actionsFetcher = useFetcher<{ success?: boolean; message?: string }>();
  const isActionsBusy = actionsFetcher.state !== "idle";

  useEffect(() => {
    if (actionsFetcher.state !== "idle" || !actionsFetcher.data?.message)
      return;
    if (actionsFetcher.data.success) {
      toast.success(actionsFetcher.data.message);
    } else {
      toast.error(actionsFetcher.data.message);
    }
  }, [actionsFetcher.state, actionsFetcher.data]);

  const actionsByItemId = useMemo(() => {
    const map = new Map<string, PlanningAction[]>();
    for (const action of planningActions) {
      const list = map.get(action.itemId);
      if (list) list.push(action);
      else map.set(action.itemId, [action]);
    }
    return map;
  }, [planningActions]);

  // A row surfaces only what falls on or before its fence date (today + the
  // item's planning horizon). Moving a row's fence here is page state: it
  // re-filters what is already loaded and never touches the item.
  const timeFence = useTimeFenceOverrides();

  const fencedActionsByItemId = useMemo(() => {
    const map = new Map<string, PlanningAction[]>();
    for (const row of data) {
      const actions = actionsByItemId.get(row.id);
      if (!actions) continue;
      const fenced = actionsInsideFence(actions, timeFence.fenceDateFor(row));
      if (fenced.length > 0) map.set(row.id, fenced);
    }
    return map;
  }, [data, actionsByItemId, timeFence]);

  // What the GRID shows and acts on: under the Actions-column filter, only
  // the filtered types. The order drawer keeps every fenced action — it lists
  // the item's open orders, and one shown without its pending suggestion
  // would read as "nothing to do".
  const visibleActionsByItemId = useMemo(() => {
    if (!actionTypes) return fencedActionsByItemId;
    const map = new Map<string, PlanningAction[]>();
    for (const [itemId, actions] of fencedActionsByItemId) {
      const visible = actionsOfTypes(actions, actionTypes);
      if (visible.length > 0) map.set(itemId, visible);
    }
    return map;
  }, [fencedActionsByItemId, actionTypes]);

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
        })
    }),
    [currentUserId, canUpdate, isActionsBusy, submitActions]
  );

  return {
    actionHandlers,
    isActionsBusy,
    timeFence,
    fencedActionsByItemId,
    visibleActionsByItemId,
    submitActions
  };
}
