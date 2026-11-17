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
  /**
   * A shortage with no bin to grab from: what the location holds of the part
   * in no bin, and whether more is on its way. Set by `buildLaneBoard`.
   */
  supply?: { unbinned: number; replenishing: boolean };
  /**
   * How a shortage can be covered. A station works from its lineside stock,
   * so every shortage is something to bring or to wait for. Set by
   * `buildLaneBoard`.
   * - `site`: the warehouse holds enough: bring it
   * - `fed`: a Transfer kanban feeds the part to this station, and its source
   *   holds some: bring it
   * - `upstream`: not enough on site, and the part is made at this location
   * - `none`: not enough at this location
   */
  cover?: "site" | "fed" | "upstream" | "none";
};

/** A bin to grab a part from, and how much of what to bring it holds. */
export type StockSource = {
  storageUnitId: string;
  onHand: number;
  /**
   * The most one transfer brings: the need, capped at what the bin holds
   * after the stations before this one in line order took theirs.
   */
  quantity: number;
  /** What those earlier stations take from the bin. */
  claimed?: number;
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
  /**
   * Stock of the part outside this bin, when the bin cannot cover its need:
   * another bin, or no bin (`storageUnitId` null).
   */
  elsewhere?: { storageUnitId: string | null; onHand: number };
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
  /** Kits the rack is below its target by, counting the incomplete ones. */
  rackGap: number;
  /** A job for the kit is open. */
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
  /** Shelf bins that cannot cover what is needed from them when no other
   *  stock can, the parts an incomplete kit misses that are on no shelf, and
   *  the parts the station is short of that the location holds none of. */
  rawShort: number;
};

export type LaneVerdict = "deliver" | "finish" | "build" | "rawShort" | "ok";
export type LaneSeverity = "red" | "amber" | "green" | "unknown";

/**
 * What a station needs, worst first.
 * - `short`: this location does not hold a part it needs in the quantity
 *   needed
 * - `bring`: a part or a kit is in the warehouse or on the rack and has to be
 *   brought lineside, or an operator asked
 * - `waiting`: it waits on a part made at this location, or on a kit
 * - `ready`: it has open work and its lineside stock covers every part
 * - `idle`: no open work
 */
export type LaneNeed = "short" | "bring" | "waiting" | "ready" | "idle";

export type Lane = {
  workCenterId: string | null;
  name: string | null;
  need: LaneNeed;
  severity: LaneSeverity;
  verdict: LaneVerdict;
  work: LaneWork;
  /** An open operation runs at the station. */
  open: boolean;
  /** Parts and kits to bring lineside from the warehouse or the rack. */
  toBring: number;
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

/**
 * What the lane needs, from how each shortage is covered. A shortage with no
 * cover (no stock read) counts as the station card ranked it: out is short,
 * low is to bring.
 */
export function laneNeed(lane: Omit<Lane, "need" | "severity">): LaneNeed {
  const shortages = lane.looseRows.filter((row) => row.kind === "shortage");
  const isShort = (row: LineFeedRow) =>
    row.cover === "none" || (!row.cover && row.stockStatus !== "low");
  if (shortages.some(isShort)) return "short";
  if (
    lane.work.deliver > 0 ||
    lane.station.status === "low" ||
    lane.looseRows.some((row) => row.kind === "request") ||
    shortages.some(
      (row) => row.cover === "site" || row.cover === "fed" || !row.cover
    )
  ) {
    return "bring";
  }
  if (
    lane.verdict !== "ok" ||
    shortages.some((row) => row.cover === "upstream") ||
    lane.kits.some((kit) => kit.stationStatus !== "ok")
  ) {
    return "waiting";
  }
  return lane.open ? "ready" : "idle";
}

const needSeverity: Record<LaneNeed, LaneSeverity> = {
  short: "red",
  bring: "amber",
  waiting: "amber",
  ready: "green",
  idle: "unknown"
};

const severityOrder: Record<LaneSeverity, number> = {
  red: 0,
  amber: 1,
  green: 2,
  unknown: 3
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

function buildLane(
  station: StationCard,
  rows: LaneRowInput[],
  open: boolean
): Lane {
  const kits = new Map<string, LaneKit>();
  const jobs = new Map<string, IncompleteKit>();
  for (const row of rows) {
    if (row.tier !== "kit" || row.state !== "slot" || !row.itemId) continue;
    kits.set(row.itemId, {
      itemId: row.itemId,
      storageUnitId: row.storageUnitId ?? null,
      kanbanId: row.kanbanId ?? null,
      target: row.target ?? null,
      rackGap: 0,
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

  for (const kit of kits.values()) {
    if (kit.target !== null) {
      kit.rackGap = Math.max(
        kit.target - total(kit.complete) - total(kit.incomplete),
        0
      );
    }
  }

  // Where each part the station consumes can be grabbed.
  const sources = new Map<string, LaneRowInput>();
  for (const row of rows) {
    if (row.state === "source" && row.itemId) sources.set(row.itemId, row);
  }

  // Shelf bins, one per part and bin. A part that feeds two kits adds both
  // kits' needs to the one bin.
  const bins = new Map<string, RawBin & { perKit: number; level: number }>();
  const binByItem = new Map<string, RawBin>();
  const components = new Map<string, { bin: RawBin; perKit: number }[]>();
  // The source bin of a Transfer kanban into this station, by part.
  const directByItem = new Map<string, RawBin>();
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
    if (!row.parentKitItemId && !directByItem.has(row.itemId)) {
      directByItem.set(row.itemId, bin);
    }
    const kit = row.parentKitItemId ? kits.get(row.parentKitItemId) : undefined;
    if (!kit) continue;
    const perKit = row.need ?? 0;
    bin.kitItemIds.push(kit.itemId);
    bin.perKit = Math.max(bin.perKit, perKit);
    bin.need += perKit * kit.rackGap;
    const parts = components.get(kit.itemId) ?? [];
    parts.push({ bin, perKit });
    components.set(kit.itemId, parts);
  }

  // A part can be on several bins, and short once.
  const short = new Set<string>();
  for (const row of rows) {
    if (row.state !== "missing" || !row.jobId || !row.itemId) continue;
    const quantity = row.quantity ?? 0;
    jobs.get(row.jobId)?.missing.push({ itemId: row.itemId, quantity });
    const bin = binByItem.get(row.itemId);
    if (bin) bin.need += quantity;
    // A kit job's part that the kit's method no longer lists has no shelf
    // row: the kit still waits on it.
    else short.add(row.itemId);
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

  const work: LaneWork = {
    deliver: 0,
    finish: 0,
    build: 0,
    rawShort: short.size
  };
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
    if (bin.status === "empty" || bin.status === "short") {
      // The part's stock in another bin, or in no bin.
      const other = sources.get(bin.itemId);
      const held = other?.quantity ?? 0;
      const sameBin = (other?.storageUnitId ?? null) === bin.storageUnitId;
      if (held > 0 && !sameBin) {
        bin.elsewhere = {
          storageUnitId: other?.storageUnitId ?? null,
          onHand: held
        };
      }
      if (
        bin.need > 0 &&
        bin.onHand + (bin.elsewhere?.onHand ?? 0) < bin.need
      ) {
        work.rawShort += 1;
        short.add(bin.itemId);
      }
    }
    raw.push(bin);
  }

  for (const kit of kits.values()) {
    const atStation = total(kit.atStation);
    kit.covers = Math.min(atStation, kit.demand);
    // The water spider brings a kit when the station runs out, not one per
    // open unit: the rack is the buffer.
    const coming = (inTransit.get(kit.itemId) ?? 0) > 0;
    // `claimStock` turns `out` into `bring` when the rack has a kit left.
    if (kit.demand > 0 && atStation <= 0) {
      kit.stationStatus = coming ? "coming" : "out";
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
    if (coversOneKit) work.build += kit.rackGap;
  }

  const looseRows = station.rows.flatMap((line): LineFeedRow[] => {
    if (line.kind !== "shortage" || !line.itemId) return [line];
    if (kits.has(line.itemId)) return [];
    // The bin the station's own Transfer kanban draws from, while it holds
    // stock; else the item's default or fullest bin.
    const direct = directByItem.get(line.itemId);
    if (direct?.storageUnitId && direct.onHand > 0) {
      return [
        {
          ...line,
          cover: "fed",
          source: {
            storageUnitId: direct.storageUnitId,
            onHand: direct.onHand,
            quantity: 0
          }
        }
      ];
    }
    const stock = sources.get(line.itemId);
    if (!stock) return [line];
    const onHand = stock.quantity ?? 0;
    // `claimStock` settles the cover from what the site holds.
    if (stock.storageUnitId && onHand > 0) {
      return [
        {
          ...line,
          cover: "none",
          source: { storageUnitId: stock.storageUnitId, onHand, quantity: 0 }
        }
      ];
    }
    // No bin holds it. With none in no bin either, only a receipt or a job
    // can feed the station.
    if (onHand <= 0) {
      if (!short.has(line.itemId)) work.rawShort += 1;
      short.add(line.itemId);
    }
    return [
      {
        ...line,
        cover: "none",
        supply: { unbinned: onHand, replenishing: stock.replenishing ?? false }
      }
    ];
  });

  // `claimStock` sets the deliver count, the verdict, the need and the
  // severity.
  return {
    workCenterId: station.workCenterId,
    name: station.name,
    need: "idle",
    severity: "unknown",
    verdict: "ok",
    open,
    toBring: 0,
    work,
    shortItemIds: [...short],
    raw,
    kits: [...kits.values()],
    station,
    looseRows
  };
}

/**
 * Gives each bin's stock and each rack kit to one station, in line order, so
 * two stations are never told to grab the same parts. A station later in the
 * line gets what the earlier ones leave: a smaller move, or none. The stock
 * of the whole site is given out the same way, and decides how each shortage
 * is covered. Then each lane's verdict, need and severity follow.
 */
function claimStock(
  lanesInLineOrder: Lane[],
  site: { onHand: Map<string, number>; made: Set<string> }
) {
  const left = new Map<string, number>();
  const take = (key: string, onHand: number, wanted: number) => {
    const free = left.get(key) ?? onHand;
    const taken = Math.min(wanted, free);
    left.set(key, round(free - taken));
    return { taken, claimed: round(onHand - free) };
  };

  for (const lane of lanesInLineOrder) {
    for (const kit of lane.kits) {
      if (kit.stationStatus !== "out") continue;
      for (const unit of kit.complete) {
        if (!unit.storageUnitId) continue;
        const key = `kit:${kit.itemId}:${unit.storageUnitId}:${unit.trackedEntityId}`;
        const { taken, claimed } = take(key, unit.quantity, 1);
        if (taken <= 0) continue;
        kit.stationStatus = "bring";
        kit.source = {
          storageUnitId: unit.storageUnitId,
          onHand: unit.quantity,
          quantity: taken,
          ...(claimed > 0 && { claimed }),
          trackedEntityId: unit.trackedEntityId ?? undefined
        };
        lane.work.deliver += 1;
        break;
      }
    }

    for (const line of lane.looseRows) {
      if (line.kind !== "shortage" || !line.itemId || !line.cover) continue;
      const wanted = line.quantity ?? 0;
      if (line.source) {
        const key = `bin:${line.itemId}:${line.source.storageUnitId}`;
        const { taken, claimed } = take(key, line.source.onHand, wanted);
        line.source = {
          ...line.source,
          quantity: taken,
          ...(claimed > 0 && { claimed })
        };
        // A kanban part is brought from its source bin while that holds some.
        if (line.cover === "fed" && taken > 0) continue;
      }
      const onSite = site.onHand.get(line.itemId) ?? 0;
      const covered = take(`site:${line.itemId}`, onSite, wanted).taken;
      line.cover =
        covered >= wanted
          ? "site"
          : site.made.has(line.itemId)
            ? "upstream"
            : "none";
    }

    lane.toBring =
      lane.work.deliver +
      lane.looseRows.filter(
        (row) => row.cover === "site" || row.cover === "fed"
      ).length;
    lane.verdict = laneVerdict(lane.work);
    lane.need = laneNeed(lane);
    lane.severity = needSeverity[lane.need];
  }
}

/** One row of the flow map. */
export type FlowRow = {
  /**
   * `line`: the stations of one made item's routing, in order. `prep`: the
   * stations whose routing is a single step (kitting benches). `other`: the
   * stations of no routing with an open job.
   */
  type: "line" | "prep" | "other";
  /** The item a `line` makes. */
  itemId: string | null;
  /** Work center ids. The stations of one step run in parallel. */
  steps: string[][];
  /** The station of another row that takes this row's item. */
  feeds?: { itemId: string; workCenterId: string };
};

/**
 * The flow map: the stations in the order of the process. A station can be on
 * several routings (three engine sizes share a line); it shows once, on the
 * routing with an open job, then the one with the most stations. A row comes
 * before the row it feeds.
 */
export function buildFlow(
  stations: { workCenterId: string | null; name: string | null }[],
  laneRows: LaneRowInput[]
): FlowRow[] {
  const steps = laneRows.filter(
    (row) => row.tier === "flow" && row.state === "step" && row.itemId
  );
  const size = new Map<string, number>();
  for (const step of steps) {
    size.set(step.itemId ?? "", (size.get(step.itemId ?? "") ?? 0) + 1);
  }
  const rank = (step: LaneRowInput): [number, number, string] => [
    step.replenishing ? 0 : 1,
    -(size.get(step.itemId ?? "") ?? 0),
    step.itemId ?? ""
  ];
  const chosen = new Map<string, LaneRowInput>();
  for (const step of steps) {
    const current = chosen.get(step.workCenterId);
    if (!current || rank(step) < rank(current)) {
      chosen.set(step.workCenterId, step);
    }
  }

  const names = new Map(
    stations.map((station) => [station.workCenterId, station.name ?? ""])
  );
  const byName = (a: string, b: string) =>
    (names.get(a) ?? "").localeCompare(names.get(b) ?? "", undefined, {
      numeric: true
    });

  const routings = new Map<string, { running: boolean; ids: string[] }>();
  const loose: string[] = [];
  for (const station of stations) {
    const id = station.workCenterId;
    if (!id) continue;
    const step = chosen.get(id);
    if (!step?.itemId) {
      loose.push(id);
      continue;
    }
    const routing = routings.get(step.itemId) ?? {
      running: Boolean(step.replenishing),
      ids: []
    };
    routing.ids.push(id);
    routings.set(step.itemId, routing);
  }

  const lines = new Map<string, FlowRow>();
  const prep: string[] = [];
  for (const [itemId, routing] of routings) {
    if (!routing.running) {
      loose.push(...routing.ids);
      continue;
    }
    const byOrder = new Map<number, string[]>();
    for (const id of routing.ids) {
      const order = chosen.get(id)?.quantity ?? 0;
      byOrder.set(order, [...(byOrder.get(order) ?? []), id]);
    }
    // One step is not a line, however many benches run it.
    if (byOrder.size < 2) {
      prep.push(...routing.ids);
      continue;
    }
    lines.set(itemId, {
      type: "line",
      itemId,
      steps: [...byOrder.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, ids]) => ids.sort(byName))
    });
  }

  // A line feeds the first line whose routing consumes its item at a station
  // that line shows.
  const feeders = new Map<string, FlowRow[]>();
  for (const row of laneRows) {
    if (row.tier !== "flow" || row.state !== "feed") continue;
    const line = row.itemId ? lines.get(row.itemId) : undefined;
    const parent = row.parentKitItemId ?? "";
    if (!line || line.feeds || !lines.has(parent)) continue;
    if (chosen.get(row.workCenterId)?.itemId !== parent) continue;
    line.feeds = { itemId: parent, workCenterId: row.workCenterId };
    feeders.set(parent, [...(feeders.get(parent) ?? []), line]);
  }

  const ordered: FlowRow[] = [];
  const seen = new Set<FlowRow>();
  const place = (line: FlowRow) => {
    if (seen.has(line)) return;
    seen.add(line);
    for (const feeder of feeders.get(line.itemId ?? "") ?? []) place(feeder);
    ordered.push(line);
  };
  const count = (line: FlowRow) => line.steps.flat().length;
  for (const line of [...lines.values()]
    .filter((row) => !row.feeds)
    .sort((a, b) => count(b) - count(a))) {
    place(line);
  }
  // A cycle of feeds has no root: its lines still show.
  for (const line of lines.values()) place(line);

  const group = (type: "prep" | "other", ids: string[]): FlowRow[] =>
    ids.length > 0 ? [{ type, itemId: null, steps: [ids.sort(byName)] }] : [];
  return [...group("prep", prep), ...ordered, ...group("other", loose)];
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
    if (row.tier === "flow") continue;
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
      (station.workCenterId && rowsByWorkCenter.get(station.workCenterId)) ||
        [],
      Boolean(station.workCenterId && lineOrder.has(station.workCenterId))
    )
  );

  // The order of the process: the flow map's, then the lowest open operation
  // order for a station on no routing.
  const flowOrder = new Map<string, number>();
  for (const row of buildFlow(stations, laneRows)) {
    if (row.type === "other") continue;
    for (const id of row.steps.flat()) flowOrder.set(id, flowOrder.size);
  }
  const order = (lane: Lane): [number, number] =>
    lane.workCenterId
      ? [
          flowOrder.get(lane.workCenterId) ?? Infinity,
          lineOrder.get(lane.workCenterId) ?? Infinity
        ]
      : [Infinity, Infinity];
  const compare = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

  const byLine = (a: Lane, b: Lane) =>
    compare(order(a)[0], order(b)[0]) ||
    compare(order(a)[1], order(b)[1]) ||
    (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) ||
    (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true });

  const site = { onHand: new Map<string, number>(), made: new Set<string>() };
  for (const row of laneRows) {
    if (!row.itemId) continue;
    if (row.state === "source") site.onHand.set(row.itemId, row.need ?? 0);
    else if (row.state === "step") site.made.add(row.itemId);
  }

  // Stock is claimed in line order whatever order the board shows.
  lanes.sort(byLine);
  claimStock(lanes, site);
  if (sort === "worst") {
    lanes.sort(
      (a, b) =>
        severityOrder[a.severity] - severityOrder[b.severity] || byLine(a, b)
    );
  }
  return lanes;
}

export type LaneSummary = LaneWork & { out: number; bring: number };

/** The summary strip: stations out, and the board's work by kind. */
export function summarizeLanes(lanes: Lane[]): LaneSummary {
  const summary: LaneSummary = {
    out: 0,
    bring: 0,
    deliver: 0,
    finish: 0,
    build: 0,
    rawShort: 0
  };
  for (const lane of lanes) {
    if (lane.severity === "red") summary.out += 1;
    summary.bring += lane.toBring;
    for (const kind of verdictOrder) summary[kind] += lane.work[kind];
  }
  return summary;
}
