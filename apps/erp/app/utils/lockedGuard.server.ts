// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";

const DEFAULT_MESSAGE =
  "Cannot modify a locked document. Reopen it first." as const;

/**
 * Guard for single-record routes (Pattern A).
 * If `isLocked` is true, throws a redirect with a flash error message.
 *
 * @example
 * ```ts
 * const po = await getPurchaseOrder(client, id);
 * await requireUnlocked({
 *   request,
 *   isLocked: isPurchaseOrderLocked(po.data?.status),
 *   redirectTo: path.to.purchaseOrderDetails(id),
 *   message: "Cannot modify a confirmed purchase order.",
 * });
 * ```
 */
export async function requireUnlocked({
  request,
  isLocked,
  redirectTo,
  message = DEFAULT_MESSAGE
}: {
  request: Request;
  isLocked: boolean;
  redirectTo: string;
  message?: string;
}): Promise<void> {
  if (isLocked) {
    throw redirect(redirectTo, await flash(request, error(null, message)));
  }
}

/**
 * Guard for bulk-update routes (Pattern B).
 * Returns an error response object if any record is locked, or `null` if all are unlocked.
 *
 * @example
 * ```ts
 * const lockedError = requireUnlockedBulk({
 *   statuses,
 *   checkFn: isIssueLocked,
 *   message: "Cannot modify a closed issue. Reopen it first.",
 * });
 * if (lockedError) return lockedError;
 * ```
 */
export function requireUnlockedBulk({
  statuses,
  checkFn,
  message = DEFAULT_MESSAGE
}: {
  statuses: (string | null)[];
  checkFn: (status: string | null | undefined) => boolean;
  message?: string;
}): { error: { message: string }; data: null } | null {
  const hasLocked = statuses.some((s) => checkFn(s));
  if (hasLocked) {
    return { error: { message }, data: null };
  }
  return null;
}
