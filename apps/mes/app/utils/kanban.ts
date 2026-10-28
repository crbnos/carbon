// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Whether a scan completes this kanban: its completed barcode override, or its
 * printed complete label. The label holds the origin it was printed from,
 * which need not be this deployment's ERP_URL, so only the path is compared.
 */
export function isKanbanCompleteScan(
  input: string,
  kanban: { id?: string; completedBarcodeOverride?: string | null }
): boolean {
  if (
    kanban.completedBarcodeOverride &&
    input === kanban.completedBarcodeOverride
  ) {
    return true;
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  return !!kanban.id && url.pathname === `/api/kanban/complete/${kanban.id}`;
}
