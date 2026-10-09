// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useSearchParams } from "react-router";
import type { DiffStatus } from "~/modules/shared/diff";
import type { ChangeOperationMark } from "../../projects.models";

/** The change request the Elements and element pages edit (`?cr=`). */
export function useActiveChangeRequestId() {
  const [searchParams] = useSearchParams();
  return searchParams.get("cr") || null;
}

/**
 * The action URL of a plan-layer route while a change request is open: the
 * route reads `?cr=` and writes the plan-layer change into it.
 */
export function withChangeRequest(
  action: string,
  changeRequestId: string | null
) {
  if (!changeRequestId) return action;
  const separator = action.includes("?") ? "&" : "?";
  return `${action}${separator}cr=${encodeURIComponent(changeRequestId)}`;
}

/** The plan-layer route action, with the open change request when there is one. */
export function useChangeRequestAction(action: string) {
  return withChangeRequest(action, useActiveChangeRequestId());
}

/** The diff badge of a row a change request adds, changes or removes. */
export function changeOperationStatus(
  operation: ChangeOperationMark | undefined
): DiffStatus | null {
  switch (operation) {
    case "Add":
      return "added";
    case "Update":
      return "modified";
    case "Delete":
      return "removed";
    default:
      return null;
  }
}
