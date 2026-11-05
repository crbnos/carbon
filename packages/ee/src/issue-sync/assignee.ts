// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The Carbon assignee an inbound issue implies (spec Q8, Q9).
 * - `undefined`: leave the Carbon assignee unchanged.
 * - `null`: clear it (the issue is unassigned).
 * - a user id: set it.
 */
export function resolveInboundAssignee(args: {
  issueHasAssignee: boolean;
  matchedUserId: string | null | undefined;
}): string | null | undefined {
  if (!args.issueHasAssignee) return null;
  return args.matchedUserId ?? undefined;
}
