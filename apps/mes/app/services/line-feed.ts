// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { round } from "@carbon/utils";

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
  /**
   * A shortage on the station board: `out` when the station holds none of the
   * part, `low` when it holds some. Set by `buildStationBoard`.
   */
  stockStatus?: "out" | "low";
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
 * `low` has some of a part but not enough (or the rest is on its way, or an
 * operator asked for material), `out` has none of a part it needs and none
 * coming. `unknown` has no lineside storage unit, so its stock cannot be read.
 */
export type StationStockStatus = "out" | "low" | "wet" | "unknown";

export type StationCard = {
  /** Null for work that names no work center. */
  workCenterId: string | null;
  name: string | null;
  status: StationStockStatus;
  /** Parts out, parts low, requests, then transfers on their way. */
  rows: LineFeedRow[];
};

const stationStatusOrder: Record<StationStockStatus, number> = {
  out: 0,
  low: 1,
  wet: 2,
  unknown: 3
};

/**
 * The station board: one card per work center at the location, the stations
 * that need stock first. Work for a work center that is not in `workCenters`
 * (none, inactive, or at another location) gets its own card, ranked by the
 * same status.
 *
 * A shortage is netted against the transfer lines already on their way to the
 * station: its quantity becomes what is still to bring, and a shortage the
 * transfers cover is left out, so no one brings it twice. The station is then
 * `low`, not `out`, until the transfer arrives.
 */
export function buildStationBoard({
  workCenters,
  stationWorkCenterIds,
  workCenterNames,
  rows
}: {
  workCenters: { id: string; name: string }[];
  /** The work centers that have a lineside storage unit. */
  stationWorkCenterIds: Iterable<string>;
  /** Names of the work centers the rows name that are not in `workCenters`. */
  workCenterNames: Record<string, string>;
  rows: LineFeedRow[];
}): StationCard[] {
  const withStorage = new Set(stationWorkCenterIds);
  const stockKey = (row: LineFeedRow) => `${row.workCenterId}:${row.itemId}`;

  const inTransit = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== "transfer") continue;
    inTransit.set(
      stockKey(row),
      (inTransit.get(stockKey(row)) ?? 0) + (row.quantity ?? 0)
    );
  }

  type Group = {
    out: LineFeedRow[];
    low: LineFeedRow[];
    request: LineFeedRow[];
    transfer: LineFeedRow[];
    covered: boolean;
  };
  const groups = new Map<string | null, Group>();
  const groupFor = (workCenterId: string | null) => {
    let group = groups.get(workCenterId);
    if (!group) {
      group = { out: [], low: [], request: [], transfer: [], covered: false };
      groups.set(workCenterId, group);
    }
    return group;
  };

  for (const row of rows) {
    const group = groupFor(row.workCenterId);
    if (row.kind !== "shortage") {
      group[row.kind].push(row);
      continue;
    }
    const toBring = round(
      (row.quantity ?? 0) - (inTransit.get(stockKey(row)) ?? 0)
    );
    if (toBring <= 0) {
      group.covered = true;
      continue;
    }
    const stockStatus = (row.onHand ?? 0) > 0 ? "low" : "out";
    group[stockStatus].push({ ...row, quantity: toBring, stockStatus });
  }

  const card = (
    workCenterId: string | null,
    name: string | null,
    hasStorage: boolean
  ): StationCard => {
    const group = groups.get(workCenterId);
    const status: StationStockStatus =
      group && group.out.length > 0
        ? "out"
        : group &&
            (group.low.length > 0 || group.covered || group.request.length > 0)
          ? "low"
          : hasStorage
            ? "wet"
            : "unknown";
    return {
      workCenterId,
      name,
      status,
      rows: group
        ? [...group.out, ...group.low, ...group.request, ...group.transfer]
        : []
    };
  };

  const onBoard = new Set(workCenters.map((workCenter) => workCenter.id));
  const cards = [
    ...workCenters.map((workCenter) =>
      card(workCenter.id, workCenter.name, withStorage.has(workCenter.id))
    ),
    ...[...groups.keys()]
      .filter((workCenterId) => !workCenterId || !onBoard.has(workCenterId))
      .map((workCenterId) =>
        card(
          workCenterId,
          (workCenterId && workCenterNames[workCenterId]) || null,
          Boolean(workCenterId && withStorage.has(workCenterId))
        )
      )
  ];

  return cards.sort(
    (a, b) =>
      stationStatusOrder[a.status] - stationStatusOrder[b.status] ||
      // "Station 2" before "Station 10"; a card with no name goes last.
      (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) ||
      (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true })
  );
}
