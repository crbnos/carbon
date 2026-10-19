// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Locked once closed — Done (released, part of the audit trail) or Cancelled
// (abandoned). Reopen a Cancelled CO to Draft to edit it again.
export function isChangeNoticeLocked(
  status: string | null | undefined
): boolean {
  return status === "Done" || status === "Cancelled";
}
