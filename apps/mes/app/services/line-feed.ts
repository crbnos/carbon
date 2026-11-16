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
  /** Where to grab a part the station is short of. Set by `buildLaneBoard`. */
  source?: StockSource;
};

/** A bin to grab a part from, and how much of what to bring it holds. */
export type StockSource = {
  storageUnitId: string;
  onHand: number;
  /** The most one transfer brings: the need, capped at what the bin holds. */
  quantity: number;
  /** The serial to move, for a kit. */
  trackedEntityId?: string;
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

type LaneRow =
  Database["public"]["Functions"]["get_line_feed_lanes"]["Returns"][number];

export type LaneRowInput = Pick<LaneRow, "workCenterId" | "tier" | "state"> &
  Partial<Omit<LaneRow, "workCenterId" | "tier" | "state">>;

export type RawBinStatus = "empty" | "short" | "low" | "ok";

export type RawBin = {
  itemId: string;
  /** The kits this bin's part goes into; empty for a part fed directly. */
  kitItemIds: string[];
  /** Null when the part has no default storage unit at the location. */
  storageUnitId: string | null;
  kanbanId: string | null;
  onHand: number;
  /** What the incomplete kits miss, plus a kit's worth per kit the rack lacks. */
  need: number;
  status: RawBinStatus;
  /** An open purchase order line or job will refill it. */
  replenishing: boolean;
};

export type KitUnit = {
  trackedEntityId: string | null;
  /** The kit's serial. */
  readableId: string | null;
  storageUnitId: string | null;
  quantity: number;
};

export type IncompleteKit = {
  jobId: string;
  readableId: string | null;
  storageUnitId: string | null;
  /** Kits the job still has to build. */
  quantity: number;
  missing: { itemId: string; quantity: number }[];
  /** The shelf holds every missing part. */
  covered: boolean;
};

export type LaneKit = {
  itemId: string;
  /** The kit's slot on the rack: its default storage unit. */
  storageUnitId: string | null;
  kanbanId: string | null;
  /** The rack's Make kanban quantity; null without a kanban. */
  target: number | null;
  replenishing: boolean;
  /** Open units at the station that still need a kit. */
  demand: number;
  /** Kits at the station, capped at the demand: "covers N of M". */
  covers: number;
  /**
   * The kit at the station: `bring` when it is out and the rack has one,
   * `out` when it is out and the rack has none, `coming` when it is out and
   * one is on its way.
   */
  stationStatus: "bring" | "out" | "coming" | "ok";
  /** The rack kit to bring when the status is `bring`. */
  source?: StockSource;
  atStation: KitUnit[];
  complete: KitUnit[];
  incomplete: IncompleteKit[];
};

/** What a lane has to do, counted. A count of zero means nothing to do. */
export type LaneWork = {
  /** Kits to bring: the station is out of a kit the rack has complete. */
  deliver: number;
  /** Incomplete kits whose missing parts are on the shelf. */
  finish: number;
  /** Kits the rack is below target by, when the shelf covers one. */
  build: number;
  /** Shelf bins that cannot cover what is needed from them. */
  rawShort: number;
};

export type LaneVerdict = "deliver" | "finish" | "build" | "rawShort" | "ok";
export type LaneSeverity = "red" | "amber" | "green";

export type Lane = {
  workCenterId: string | null;
  name: string | null;
  severity: LaneSeverity;
  verdict: LaneVerdict;
  work: LaneWork;
  /** The parts behind a `rawShort` count. */
  shortItemIds: string[];
  raw: RawBin[];
  kits: LaneKit[];
  station: StationCard;
  /** The station's rows less the kit shortages, which the kits show. */
  looseRows: LineFeedRow[];
};

const verdictOrder = ["deliver", "finish", "build", "rawShort"] as const;

/** The lane's bottleneck: the first kind of work it has, in the order of who
 *  can act soonest (water spider, kitter, purchasing). */
export function laneVerdict(work: LaneWork): LaneVerdict {
  return verdictOrder.find((kind) => work[kind] > 0) ?? "ok";
}

/** Red when the station is out, amber when it is low or the lane has work. */
export function laneSeverity(
  status: StationStockStatus,
  verdict: LaneVerdict
): LaneSeverity {
  if (status === "out") return "red";
  return status === "low" || verdict !== "ok" ? "amber" : "green";
}

const severityOrder: Record<LaneSeverity, number> = {
  red: 0,
  amber: 1,
  green: 2
};

const kitUnit = (row: LaneRowInput): KitUnit => ({
  trackedEntityId: row.trackedEntityId ?? null,
  // A serial with no label of its own is known by its id.
  readableId: row.readableId ?? row.trackedEntityId ?? null,
  storageUnitId: row.storageUnitId ?? null,
  quantity: row.quantity ?? 0
});

const total = (units: { quantity: number }[]) =>
  units.reduce((sum, unit) => sum + unit.quantity, 0);

function buildLane(station: StationCard, rows: LaneRowInput[]): Lane {
  const kits = new Map<string, LaneKit>();
  const jobs = new Map<string, IncompleteKit>();
  for (const row of rows) {
    if (row.tier !== "kit" || row.state !== "slot" || !row.itemId) continue;
    kits.set(row.itemId, {
      itemId: row.itemId,
      storageUnitId: row.storageUnitId ?? null,
      kanbanId: row.kanbanId ?? null,
      target: row.target ?? null,
      replenishing: row.replenishing ?? false,
      demand: row.need ?? 0,
      covers: 0,
      stationStatus: "ok",
      atStation: [],
      complete: [],
      incomplete: []
    });
  }
  for (const row of rows) {
    if (row.state === "missing" || row.tier === "raw") continue;
    const kit = row.itemId ? kits.get(row.itemId) : undefined;
    if (!kit) continue;
    if (row.tier === "station" && row.state === "kit") {
      kit.atStation.push(kitUnit(row));
    } else if (row.state === "complete") {
      kit.complete.push(kitUnit(row));
    } else if (row.state === "incomplete" && row.jobId) {
      const job: IncompleteKit = {
        jobId: row.jobId,
        readableId: row.readableId ?? null,
        storageUnitId: row.storageUnitId ?? null,
        quantity: row.quantity ?? 0,
        missing: [],
        covered: false
      };
      jobs.set(row.jobId, job);
      kit.incomplete.push(job);
    }
  }

  // Where each part the station consumes can be grabbed.
  const sources = new Map<string, LaneRowInput>();
  for (const row of rows) {
    if (row.state === "source" && row.itemId) sources.set(row.itemId, row);
  }
  const grab = (row: LaneRowInput, need: number): StockSource => ({
    storageUnitId: row.storageUnitId ?? "",
    onHand: row.quantity ?? 0,
    quantity: Math.min(need, row.quantity ?? 0)
  });

  // Shelf bins, one per part and bin. A part that feeds two kits adds both
  // kits' needs to the one bin.
  const bins = new Map<string, RawBin & { perKit: number; level: number }>();
  const binByItem = new Map<string, RawBin>();
  const components = new Map<string, { bin: RawBin; perKit: number }[]>();
  const rackGap = (kit: LaneKit) =>
    kit.target === null
      ? 0
      : Math.max(kit.target - total(kit.complete) - total(kit.incomplete), 0);
  for (const row of rows) {
    if (row.state !== "bin" || !row.itemId) continue;
    const key = `${row.itemId}:${row.storageUnitId}`;
    let bin = bins.get(key);
    if (!bin) {
      bin = {
        itemId: row.itemId,
        kitItemIds: [],
        storageUnitId: row.storageUnitId ?? null,
        kanbanId: row.kanbanId ?? null,
        onHand: row.quantity ?? 0,
        need: 0,
        status: "ok",
        replenishing: row.replenishing ?? false,
        perKit: 0,
        level: row.target ?? 0
      };
      bins.set(key, bin);
      if (!binByItem.has(row.itemId)) binByItem.set(row.itemId, bin);
    }
    const kit = row.parentKitItemId ? kits.get(row.parentKitItemId) : undefined;
    if (!kit) continue;
    const perKit = row.need ?? 0;
    bin.kitItemIds.push(kit.itemId);
    bin.perKit = Math.max(bin.perKit, perKit);
    bin.need += perKit * rackGap(kit);
    const parts = components.get(kit.itemId) ?? [];
    parts.push({ bin, perKit });
    components.set(kit.itemId, parts);
  }

  for (const row of rows) {
    if (row.state !== "missing" || !row.jobId || !row.itemId) continue;
    const quantity = row.quantity ?? 0;
    jobs.get(row.jobId)?.missing.push({ itemId: row.itemId, quantity });
    const bin = binByItem.get(row.itemId);
    if (bin) bin.need += quantity;
  }

  // A part fed directly is needed by what the station is short of.
  const inTransit = new Map<string, number>();
  for (const line of station.rows) {
    if (!line.itemId) continue;
    if (line.kind === "transfer") {
      inTransit.set(
        line.itemId,
        (inTransit.get(line.itemId) ?? 0) + (line.quantity ?? 0)
      );
    } else if (line.kind === "shortage" && !kits.has(line.itemId)) {
      const bin = binByItem.get(line.itemId);
      if (bin) bin.need += line.quantity ?? 0;
    }
  }

  const work: LaneWork = { deliver: 0, finish: 0, build: 0, rawShort: 0 };
  const shortItemIds: string[] = [];
  const raw: RawBin[] = [];
  for (const { perKit, level, ...bin } of bins.values()) {
    bin.need = round(bin.need);
    bin.status =
      bin.onHand <= 0
        ? "empty"
        : bin.onHand < bin.need
          ? "short"
          : bin.onHand < Math.max(level, perKit)
            ? "low"
            : "ok";
    if (bin.need > 0 && (bin.status === "empty" || bin.status === "short")) {
      work.rawShort += 1;
      shortItemIds.push(bin.itemId);
    }
    raw.push(bin);
  }

  for (const kit of kits.values()) {
    const atStation = total(kit.atStation);
    kit.covers = Math.min(atStation, kit.demand);
    // The water spider brings a kit when the station runs out, not one per
    // open unit: the rack is the buffer.
    const coming = (inTransit.get(kit.itemId) ?? 0) > 0;
    if (kit.demand > 0 && atStation <= 0) {
      kit.stationStatus = coming
        ? "coming"
        : kit.complete.length > 0
          ? "bring"
          : "out";
    }
    if (kit.stationStatus === "bring") {
      work.deliver += 1;
      const [unit] = kit.complete;
      if (unit.storageUnitId) {
        kit.source = {
          storageUnitId: unit.storageUnitId,
          onHand: unit.quantity,
          quantity: 1,
          trackedEntityId: unit.trackedEntityId ?? undefined
        };
      }
    }

    for (const job of kit.incomplete) {
      job.covered = job.missing.every(
        (line) => (binByItem.get(line.itemId)?.onHand ?? 0) >= line.quantity
      );
      if (job.covered) work.finish += job.quantity;
    }

    const parts = components.get(kit.itemId) ?? [];
    const coversOneKit =
      parts.length > 0 && parts.every((part) => part.bin.onHand >= part.perKit);
    if (coversOneKit) work.build += rackGap(kit);
  }

  const verdict = laneVerdict(work);
  return {
    workCenterId: station.workCenterId,
    name: station.name,
    severity: laneSeverity(station.status, verdict),
    verdict,
    work,
    shortItemIds,
    raw,
    kits: [...kits.values()],
    station,
    looseRows: station.rows.flatMap((line) => {
      if (line.kind !== "shortage" || !line.itemId) return [line];
      if (kits.has(line.itemId)) return [];
      const source = sources.get(line.itemId);
      return source
        ? [{ ...line, source: grab(source, line.quantity ?? 0) }]
        : [line];
    })
  };
}

/**
 * The lane board: one lane per station card, each with its kit rack and raw
 * shelf above it and the bottleneck that holds it up. Lanes run in line order
 * (the lowest open operation order at the station, then the name), or worst
 * first.
 */
export function buildLaneBoard({
  stations,
  laneRows,
  sort = "line"
}: {
  stations: StationCard[];
  laneRows: LaneRowInput[];
  sort?: "line" | "worst";
}): Lane[] {
  const rowsByWorkCenter = new Map<string, LaneRowInput[]>();
  const lineOrder = new Map<string, number>();
  for (const row of laneRows) {
    if (row.state === "line") {
      lineOrder.set(row.workCenterId, row.quantity ?? 0);
      continue;
    }
    const rows = rowsByWorkCenter.get(row.workCenterId);
    if (rows) rows.push(row);
    else rowsByWorkCenter.set(row.workCenterId, [row]);
  }

  const lanes = stations.map((station) =>
    buildLane(
      station,
      (station.workCenterId && rowsByWorkCenter.get(station.workCenterId)) || []
    )
  );
  const order = (lane: Lane) =>
    (lane.workCenterId ? lineOrder.get(lane.workCenterId) : undefined) ??
    Infinity;

  return lanes.sort(
    (a, b) =>
      (sort === "worst"
        ? severityOrder[a.severity] - severityOrder[b.severity]
        : 0) ||
      order(a) - order(b) ||
      (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) ||
      (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true })
  );
}

export type LaneSummary = LaneWork & { out: number };

/** The summary strip: stations out, and the board's work by kind. */
export function summarizeLanes(lanes: Lane[]): LaneSummary {
  const summary: LaneSummary = {
    out: 0,
    deliver: 0,
    finish: 0,
    build: 0,
    rawShort: 0
  };
  for (const lane of lanes) {
    if (lane.severity === "red") summary.out += 1;
    for (const kind of verdictOrder) summary[kind] += lane.work[kind];
  }
  return summary;
}
