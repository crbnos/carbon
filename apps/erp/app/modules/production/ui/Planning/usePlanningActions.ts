// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useRef } from "react";
import { actionsOfTypes } from "~/modules/production/production.models";
import type { PlanningAction } from "~/modules/production/types";
import {
  type FenceRow,
  useTimeFenceOverrides
} from "~/modules/production/ui/Planning/PlanningFence";
import { actionsInsideFence } from "~/modules/production/ui/Planning/planning-fence";
import { isStaleRelease } from "~/modules/production/ui/Planning/planning-review";

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
  const { t } = useLingui();
  const describePlanningResult = usePlanningResultMessage();
  // The worklist action last submitted, for the toast that answers it.
  const lastAction = useRef<string | null>(null);
  const actionsFetcher = useAction<PlanningActionsResult>({
    onSuccess: (result) => {
      const outcome = describePlanningResult(result, lastAction.current);
      if (outcome?.ok) toast.success(outcome.message);
      else if (outcome) toast.error(outcome.message);
    },
    // The purchasing route answers `{ success: false, message }`; a service
    // function's error is `{ error: { message } }`.
    onError: (result) => {
      const message =
        "message" in result && typeof result.message === "string"
          ? result.message
          : "error" in result && result.error
            ? result.error.message
            : t`Something went wrong`;
      toast.error(message);
    }
  });
  const isActionsBusy = actionsFetcher.state !== "idle";

  const actionsByItemId = useMemo(() => {
    const map = new Map<string, PlanningAction[]>();
    for (const action of planningActions) {
      // a Release whose order moved on since MRP ran no longer applies
      if (isStaleRelease(action)) continue;
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
      lastAction.current =
        typeof payload.action === "string" ? payload.action : null;
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
    actionsByItemId,
    fencedActionsByItemId,
    visibleActionsByItemId,
    submitActions
  };
}

/**
 * What a worklist submission answers: the production route's service result
 * (`{ data, error }`), or the purchasing route's `{ success, message }`.
 */
type PlanningActionsResult =
  | { success?: boolean; message?: string }
  | {
      data: {
        applied?: string[];
        requiresManualAction?: unknown[];
        warnings?: string[];
        errors?: string[];
        changed?: number;
        requested?: number;
      } | null;
      error: { message: string } | null;
    };

/**
 * The toast for a successful worklist submission, or null for none. A hook,
 * so the Lingui macro binds `t` here (it does not follow a `t` passed in).
 */
function usePlanningResultMessage() {
  const { t } = useLingui();
  return (
    result: PlanningActionsResult,
    action: string | null
  ): { ok: boolean; message: string } | null => {
    if ("message" in result || "success" in result) {
      return result.message
        ? { ok: result.success !== false, message: result.message }
        : null;
    }
    if (!("data" in result) || !result.data) return null;
    const data = result.data;

    if (data.changed !== undefined) {
      const changed = data.changed;
      const stale = (data.requested ?? changed) - changed;
      const done =
        action === "dismiss"
          ? changed === 1
            ? t`Dismissed 1 planning action`
            : t`Dismissed ${changed} planning actions`
          : action === "reopen"
            ? changed === 1
              ? t`Reopened 1 planning action`
              : t`Reopened ${changed} planning actions`
            : changed === 1
              ? t`Assigned 1 planning action`
              : t`Assigned ${changed} planning actions`;
      return {
        ok: true,
        message:
          stale > 0
            ? `${done}; ${t`${stale} changed since the page loaded`}`
            : done
      };
    }

    const applied = data.applied?.length ?? 0;
    const manual = data.requiresManualAction?.length ?? 0;
    const warnings = data.warnings?.length ?? 0;
    const errors = data.errors?.length ?? 0;
    const parts = [
      applied === 1
        ? t`Applied 1 planning action`
        : t`Applied ${applied} planning actions`
    ];
    if (manual > 0) {
      parts.push(
        manual === 1
          ? t`1 target is committed — review on the order`
          : t`${manual} targets are committed — review on the order`
      );
    }
    if (warnings > 0) parts.push(t`${warnings} need a follow-up`);
    if (errors > 0) parts.push(t`${errors} failed`);
    return {
      ok: errors === 0 && warnings === 0 && !(applied === 0 && manual > 0),
      message: parts.join("; ")
    };
  };
}
