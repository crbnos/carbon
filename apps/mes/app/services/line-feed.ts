// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";

type LineFeedShortage =
  Database["public"]["Functions"]["get_line_feed_shortages"]["Returns"][number];

type MaterialRequestRow =
  Database["public"]["Tables"]["materialRequest"]["Row"];

type StockTransferLineRow =
  Database["public"]["Tables"]["stockTransferLine"]["Row"];

export type LineFeedRequestInput = Pick<
  MaterialRequestRow,
  "id" | "workCenterId" | "itemId" | "createdAt" | "note"
>;

export type LineFeedTransferInput = Pick<
  StockTransferLineRow,
  "id" | "itemId" | "outstandingQuantity" | "createdAt"
> & {
  toStorageUnitId?: string | null;
  stockTransfer: { id: string };
  toStorageUnit: { workCenterId: string | null } | null;
};

export type LineFeedRow = {
  kind: "request" | "shortage" | "transfer";
  key: string;
  workCenterId: string | null;
  storageUnitId: string | null;
  itemId: string | null;
  quantity: number | null;
  createdAt: string | null;
  materialRequestId?: string;
  stockTransferId?: string;
  note?: string | null;
};

// ISO timestamps from Postgres sort correctly as strings.
function byCreatedAt(a: { createdAt: string }, b: { createdAt: string }) {
  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;
  return 0;
}

/**
 * The line feeder's work queue: open requests first (oldest first), then
 * lineside shortages (largest first), then outstanding transfer lines
 * (oldest first).
 */
export function buildLineFeedRows({
  requests,
  shortages,
  transfers
}: {
  requests: LineFeedRequestInput[];
  shortages: LineFeedShortage[];
  transfers: LineFeedTransferInput[];
}): LineFeedRow[] {
  const requestRows: LineFeedRow[] = [...requests]
    .sort(byCreatedAt)
    .map((request) => ({
      kind: "request",
      key: `request:${request.id}`,
      workCenterId: request.workCenterId,
      storageUnitId: null,
      itemId: request.itemId,
      quantity: null,
      createdAt: request.createdAt,
      materialRequestId: request.id,
      note: request.note
    }));

  const shortageRows: LineFeedRow[] = [...shortages]
    .sort((a, b) => b.short - a.short)
    .map((shortage) => ({
      kind: "shortage",
      key: `shortage:${shortage.workCenterId}:${shortage.storageUnitId}:${shortage.itemId}`,
      workCenterId: shortage.workCenterId,
      storageUnitId: shortage.storageUnitId,
      itemId: shortage.itemId,
      quantity: shortage.short,
      createdAt: null
    }));

  const transferRows: LineFeedRow[] = [...transfers]
    .sort(byCreatedAt)
    .map((transfer) => ({
      kind: "transfer",
      key: `transfer:${transfer.id}`,
      workCenterId: transfer.toStorageUnit?.workCenterId ?? null,
      storageUnitId: transfer.toStorageUnitId ?? null,
      itemId: transfer.itemId,
      quantity: transfer.outstandingQuantity,
      createdAt: transfer.createdAt,
      stockTransferId: transfer.stockTransfer.id
    }));

  return [...requestRows, ...shortageRows, ...transferRows];
}
