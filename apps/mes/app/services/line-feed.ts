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
  /** A shortage's usable stock at the station: 0 means the part is out. */
  onHand?: number;
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
      onHand: shortage.onHand,
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

/**
 * Whether a station's line is wet: `wet` has the stock its open work needs,
 * `low` has some of a part but not enough (or an operator asked for material),
 * `out` has none of a part it needs. `unknown` has no lineside storage unit,
 * so its stock cannot be read.
 */
export type StationStockStatus = "out" | "low" | "wet" | "unknown";

export type StationStatus = {
  workCenterId: string;
  name: string;
  status: StationStockStatus;
  /** Parts the station needs and holds none of. */
  out: number;
  /** Parts the station holds, but less than its open work needs. */
  low: number;
  /** Open material requests from the station. */
  requests: number;
};

const stationStatusOrder: Record<StationStockStatus, number> = {
  out: 0,
  low: 1,
  wet: 2,
  unknown: 3
};

/** One status per work center, the stations that need stock first. */
export function buildStationStatuses({
  workCenters,
  stationWorkCenterIds,
  shortages,
  requests
}: {
  workCenters: { id: string; name: string }[];
  /** The work centers that have a lineside storage unit. */
  stationWorkCenterIds: Iterable<string>;
  shortages: Pick<LineFeedShortage, "workCenterId" | "onHand">[];
  requests: Pick<LineFeedRequestInput, "workCenterId">[];
}): StationStatus[] {
  const withStorage = new Set(stationWorkCenterIds);
  const counts = new Map<
    string,
    { out: number; low: number; requests: number }
  >();
  const countsFor = (workCenterId: string) => {
    let count = counts.get(workCenterId);
    if (!count) {
      count = { out: 0, low: 0, requests: 0 };
      counts.set(workCenterId, count);
    }
    return count;
  };

  for (const shortage of shortages) {
    const count = countsFor(shortage.workCenterId);
    if (shortage.onHand > 0) count.low += 1;
    else count.out += 1;
  }
  for (const request of requests) {
    if (request.workCenterId) countsFor(request.workCenterId).requests += 1;
  }

  return workCenters
    .map((workCenter): StationStatus => {
      const count = counts.get(workCenter.id) ?? {
        out: 0,
        low: 0,
        requests: 0
      };
      const status: StationStockStatus =
        count.out > 0
          ? "out"
          : count.low > 0 || count.requests > 0
            ? "low"
            : withStorage.has(workCenter.id)
              ? "wet"
              : "unknown";
      return {
        workCenterId: workCenter.id,
        name: workCenter.name,
        status,
        ...count
      };
    })
    .sort(
      (a, b) =>
        stationStatusOrder[a.status] - stationStatusOrder[b.status] ||
        a.name.localeCompare(b.name)
    );
}
