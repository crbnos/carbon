// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { useAction, useRevalidator, useTopic } from "@carbon/query";
import {
  Badge,
  Button,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  Input
} from "@carbon/react";
import { formatQuantity } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  LuArrowRightLeft,
  LuChevronDown,
  LuChevronRight,
  LuExternalLink
} from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { DateTime } from "~/components";
import ItemThumbnail from "~/components/ItemThumbnail";
import { MesAppBar, MesQueueHeader } from "~/components/MesAppBar";
import { MesEmptyState } from "~/components/MesEmptyState";
import { ResolveMaterialRequestButton } from "~/components/ResolveMaterialRequestButton";
import SearchFilter from "~/components/SearchFilter";
import { userContext } from "~/context";
import { useRealtimeRevalidator, useUser } from "~/hooks";
import { getLineFeed } from "~/services/inventory.service";
import type {
  FlowRow,
  Lane,
  LaneKit,
  LaneNeed,
  LaneSeverity,
  LaneSummary,
  LineFeedRow,
  RawBin,
  StockSource
} from "~/services/line-feed";
import type { Handle } from "~/utils/handle";
import { pageMeta } from "~/utils/meta";
import { path } from "~/utils/path";

const logger = getLogger("mes", "line-feed");

export const handle: Handle = {
  realtime: [
    "materialRequest",
    "stockTransfer",
    "stockTransferLine",
    "jobOperation",
    "itemLedger",
    "job",
    "jobMaterial",
    "purchaseOrderLine"
  ]
};

export const meta: MetaFunction = () => pageMeta("Line feed");

type Names = {
  itemReadableIds: Record<string, string>;
  itemNames: Record<string, string>;
  itemThumbnailPaths: Record<string, string>;
  storageUnitNames: Record<string, string>;
  jobReadableIds: Record<string, string>;
  stockTransferReadableIds: Record<string, string>;
};

const emptyLineFeed = {
  lanes: [] as Lane[],
  flow: [] as FlowRow[],
  summary: { out: 0, bring: 0, deliver: 0, finish: 0, build: 0, rawShort: 0 },
  itemReadableIds: {},
  itemNames: {},
  itemThumbnailPaths: {},
  storageUnitNames: {},
  jobReadableIds: {},
  stockTransferReadableIds: {},
  canTransfer: false,
  // A failed read is not an empty queue: the screen says so and offers a retry.
  loadFailed: false,
  noLocation: false
} satisfies Names & Record<string, unknown>;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { client, companyId, permissions } = await requirePermissions(request, {
    view: "inventory"
  });
  const locationId = context.get(userContext)?.locationId;
  if (!locationId) return { ...emptyLineFeed, noLocation: true };
  // A hint for the Move buttons; the transfer action checks it again.
  const canTransfer =
    permissions.inventory?.create?.includes(companyId) ?? false;

  const lineFeed = await getLineFeed(client, { companyId, locationId });
  if (lineFeed.error || !lineFeed.data) {
    logger.error("Failed to load the line feed", {
      companyId,
      locationId,
      error: lineFeed.error
    });
    return { ...emptyLineFeed, loadFailed: true };
  }

  return {
    ...lineFeed.data,
    canTransfer,
    loadFailed: false,
    noLocation: false
  };
}

type SummaryKind = keyof LaneSummary;

const summaryKinds: SummaryKind[] = [
  "out",
  "bring",
  "deliver",
  "finish",
  "build",
  "rawShort"
];

/** The key of work that names no work center: its lane has no id. */
const NO_STATION = "none";
const laneKey = (lane: Lane) => lane.workCenterId ?? NO_STATION;

const inSummary = (lane: Lane, kind: SummaryKind) =>
  kind === "out"
    ? lane.severity === "red"
    : kind === "bring"
      ? lane.toBring > 0
      : lane.work[kind] > 0;

/** What a station needs, in a word. */
function useNeedLabels(): Record<LaneNeed, string> {
  const { t } = useLingui();
  return {
    short: t`Short`,
    bring: t`Bring`,
    waiting: t`Waiting`,
    ready: t`Ready`,
    idle: t`No open work`
  };
}

export default function LineFeedRoute() {
  const {
    lanes,
    flow,
    summary,
    canTransfer,
    loadFailed,
    noLocation,
    ...names
  } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const { t } = useLingui();

  // The selected summary count and the station search live in the URL, so a
  // link to the board opens the same view.
  const [searchParams] = useSearchParams();
  const shown = summaryKinds.find((kind) => kind === searchParams.get("show"));
  const search = (searchParams.get("search") ?? "").trim().toLowerCase();
  const visible = new Map(
    lanes
      .filter(
        (lane) =>
          (shown === undefined || inSummary(lane, shown)) &&
          (search === "" ||
            (lane.name ?? t`No station`).toLowerCase().includes(search))
      )
      .map((lane) => [laneKey(lane), lane])
  );
  const withParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    return `?${next}`;
  };

  // The open station is the user's own choice: opening it reads nothing new.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId
    ? lanes.find((lane) => laneKey(lane) === openId)
    : undefined;

  // Work centers and storage units broadcast on the shared reference topic,
  // which `handle.realtime` cannot name: a new station, lineside storage unit
  // or kit rack shows without waiting for a stock change.
  const { company } = useUser();
  const revalidate = useRealtimeRevalidator();
  useTopic(`company:${company.id}:reference`, (change) => {
    if (
      !change ||
      change.table === "workCenter" ||
      change.table === "storageUnit"
    ) {
      revalidate();
    }
  });

  const searchBox = (
    <SearchFilter param="search" placeholder={t`Search stations`} />
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MesAppBar title={<Trans>Line feed</Trans>} actions={searchBox} />
      <MesQueueHeader title={<Trans>Line feed</Trans>} actions={searchBox} />

      {loadFailed ? (
        <MesEmptyState
          className="flex-1 w-full"
          title={<Trans>Could not load the line feed</Trans>}
          action={
            <Button
              isLoading={revalidator.state !== "idle"}
              isDisabled={revalidator.state !== "idle"}
              onClick={() => revalidator.revalidate()}
            >
              <Trans>Try again</Trans>
            </Button>
          }
        />
      ) : lanes.length > 0 ? (
        <>
          <SummaryStrip
            summary={summary}
            shown={shown}
            hrefFor={(kind) => withParam("show", kind === shown ? null : kind)}
          />
          {visible.size > 0 ? (
            <FlowMap
              flow={flow}
              visible={visible}
              names={names}
              onOpen={setOpenId}
            />
          ) : (
            <MesEmptyState
              className="flex-1 w-full"
              title={<Trans>No stations match</Trans>}
            />
          )}
          <Drawer
            open={open !== undefined}
            onOpenChange={(isOpen) => {
              if (!isOpen) setOpenId(null);
            }}
          >
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>{open?.name ?? t`No station`}</DrawerTitle>
              </DrawerHeader>
              <DrawerBody className="p-3">
                {open && (
                  <LaneColumn
                    lane={open}
                    canTransfer={canTransfer}
                    names={names}
                  />
                )}
              </DrawerBody>
            </DrawerContent>
          </Drawer>
        </>
      ) : (
        <MesEmptyState
          className="flex-1 w-full"
          title={
            noLocation ? (
              <Trans>Select a location to see its stations</Trans>
            ) : (
              <Trans>No stations at this location</Trans>
            )
          }
        />
      )}
    </div>
  );
}

/**
 * The stations in the order of the process, one tile each: its colour and a
 * word say what it needs. A row is the routing of one made item; a row comes
 * before the row it feeds. A tile opens the station.
 */
function FlowMap({
  flow,
  visible,
  names,
  onOpen
}: {
  flow: FlowRow[];
  /** The lanes the filters leave, by `laneKey`. */
  visible: Map<string, Lane>;
  names: Names;
  onOpen: (workCenterId: string) => void;
}) {
  const { t } = useLingui();
  const labels = useNeedLabels();
  // What the water spider reads: how many parts are missing, how many to bring.
  const tileLabel = (lane: Lane) => {
    const short = lane.looseRows.filter((row) => row.cover === "none").length;
    const parts = [
      short > 0 && t`Short ${short}`,
      lane.toBring > 0 && t`Bring ${lane.toBring}`
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : labels[lane.need];
  };
  const title = (row: FlowRow) =>
    row.type === "prep"
      ? t`Kitting and preparation`
      : row.type === "other"
        ? t`Other stations`
        : [
            names.itemReadableIds[row.itemId ?? ""],
            names.itemNames[row.itemId ?? ""]
          ]
            .filter(Boolean)
            .join(" · ");

  const noStation = visible.get(NO_STATION);

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-auto p-4 scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
      {flow.map((row) => {
        // Only a routing has steps in order; the other rows are a plain list.
        const steps = (
          row.type === "line" ? row.steps : row.steps.flat().map((id) => [id])
        )
          .map((ids) => ids.flatMap((id) => visible.get(id) ?? []))
          .filter((step) => step.length > 0);
        if (steps.length === 0) return null;
        const feeds = row.feeds && visible.get(row.feeds.workCenterId)?.name;
        const heading = (
          <>
            <span className="truncate">{title(row)}</span>
            {feeds && (
              <span className="normal-case tracking-normal">
                <Trans>goes to {feeds}</Trans>
              </span>
            )}
          </>
        );
        const headingClass =
          "flex flex-wrap items-baseline gap-x-2 text-xs font-medium uppercase tracking-wide text-muted-foreground";
        const tiles = (
          <ol className="flex flex-wrap items-center gap-y-2">
            {steps.map((step, index) => (
              <li
                key={step[0].workCenterId}
                className={cn(
                  "flex items-center",
                  row.type !== "line" && "mr-2"
                )}
              >
                {row.type === "line" && index > 0 && (
                  <LuChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <div className="flex flex-col gap-1">
                  {step.map((lane) => (
                    <StationTile
                      key={lane.workCenterId}
                      lane={lane}
                      label={tileLabel(lane)}
                      onOpen={onOpen}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        );
        // The stations off the process fold away unless one needs something.
        if (row.type === "other") {
          const calm = steps.every(([lane]) =>
            ["idle", "ready"].includes(lane.need)
          );
          return (
            <details key="other" open={!calm} className="group/other">
              <summary
                className={cn(
                  headingClass,
                  "min-h-11 cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden"
                )}
              >
                {heading}
                <span className="tabular-nums">{steps.length}</span>
                <LuChevronDown
                  className="size-4 self-center group-open/other:rotate-180"
                  aria-hidden
                />
              </summary>
              {tiles}
            </details>
          );
        }
        return (
          <section
            key={`${row.type}:${row.itemId}`}
            className="flex flex-col gap-2"
          >
            <h2 className={headingClass}>{heading}</h2>
            {tiles}
          </section>
        );
      })}
      {noStation && (
        // Work that names no work center (a request, a transfer) is on no
        // routing: it has its own tile so it can be opened and resolved.
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Trans>No station</Trans>
          </h2>
          <StationTile
            lane={noStation}
            label={tileLabel(noStation)}
            onOpen={onOpen}
          />
        </section>
      )}
    </div>
  );
}

function StationTile({
  lane,
  label,
  onOpen
}: {
  lane: Lane;
  label: string;
  onOpen: (workCenterId: string) => void;
}) {
  const tone = laneTone[lane.severity];
  return (
    <button
      type="button"
      onClick={() => onOpen(laneKey(lane))}
      className={cn(
        "flex min-h-11 w-40 flex-col justify-center gap-0.5 rounded-md border px-2 py-1 text-left",
        tone.lane,
        lane.need === "idle" && "opacity-60"
      )}
    >
      <span className="line-clamp-2 text-xs font-semibold leading-tight">
        {lane.name ?? <Trans>No station</Trans>}
      </span>
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          className={cn("size-2 shrink-0 rounded-full", tone.dot)}
          aria-hidden
        />
        {label}
      </span>
    </button>
  );
}

/** The board's work by kind. A count links to the board with only its lanes. */
function SummaryStrip({
  summary,
  shown,
  hrefFor
}: {
  summary: LaneSummary;
  shown: SummaryKind | undefined;
  hrefFor: (kind: SummaryKind) => string;
}) {
  const { t } = useLingui();
  const labels: Record<SummaryKind, string> = {
    out: t`stations short`,
    bring: t`to bring lineside`,
    deliver: t`kits to deliver`,
    finish: t`kits to finish`,
    build: t`kits to build`,
    rawShort: t`raw bins short`
  };
  return (
    <nav className="flex shrink-0 gap-2 overflow-x-auto border-b border-border bg-card px-4 py-2">
      {summaryKinds.map((kind) => (
        <Link
          key={kind}
          to={hrefFor(kind)}
          replace
          aria-current={shown === kind ? "true" : undefined}
          className={cn(
            "flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-border px-3 text-sm no-underline",
            shown === kind && "border-primary bg-primary/10",
            summary[kind] === 0 && "text-muted-foreground"
          )}
        >
          <span className="text-base font-semibold tabular-nums">
            {summary[kind]}
          </span>
          {labels[kind]}
        </Link>
      ))}
    </nav>
  );
}

const laneTone: Record<LaneSeverity, { lane: string; dot: string }> = {
  green: {
    lane: "border-emerald-600/30 bg-emerald-500/10",
    dot: "bg-emerald-500"
  },
  amber: {
    lane: "border-yellow-600/40 bg-yellow-500/15",
    dot: "bg-yellow-500"
  },
  red: { lane: "border-red-600/50 bg-red-500/15", dot: "bg-red-500" },
  unknown: { lane: "border-border bg-muted/40", dot: "bg-muted-foreground/40" }
};

type Tone = "green" | "yellow" | "red" | "gray";

/**
 * One station's lane, top to bottom the way material flows: raw shelf, kit
 * rack, station. The header names what holds the lane up and who acts on it.
 */
function LaneColumn({
  lane,
  canTransfer,
  names
}: {
  lane: Lane;
  /** The user may move stock: the rows offer it. */
  canTransfer: boolean;
  names: Names;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const tone = laneTone[lane.severity];
  const needLabels = useNeedLabels();
  const name = lane.name ?? t`No station`;
  const needTone: Record<LaneNeed, Tone> = {
    short: "red",
    bring: "yellow",
    waiting: "yellow",
    ready: "green",
    idle: "gray"
  };
  // What to bring comes first, then what to wait for.
  const toBring = (row: LineFeedRow) =>
    row.cover === "site" || row.cover === "fed" ? 0 : 1;
  const toAct = [...lane.looseRows].sort((a, b) => toBring(a) - toBring(b));
  // A lane can be short of twenty parts: the header names three.
  const namedParts = lane.shortItemIds
    .slice(0, 3)
    .map((id) => names.itemReadableIds[id] ?? t`Unknown part`)
    .join(", ");
  const moreParts = lane.shortItemIds.length - 3;
  const shortParts =
    moreParts > 0 ? t`${namedParts} and ${moreParts} more` : namedParts;
  const verdict: Record<Lane["verdict"], { label: string; who?: string }> = {
    deliver: { label: t`Deliver`, who: t`Water spider` },
    finish: { label: t`Finish kit`, who: t`Kitter` },
    build: { label: t`Build kit`, who: t`Kitter` },
    rawShort: { label: t`Raw short: ${shortParts}`, who: t`Purchasing` },
    ok: { label: t`OK` }
  };

  const worstBin = (["empty", "short", "low"] as const).find((status) =>
    lane.raw.some((bin) => bin.status === status)
  );
  const binLabel = { empty: t`Empty`, short: t`Short`, low: t`Low` };
  const rackLow = lane.kits.some((kit) => kit.rackGap > 0);
  const kitsReady = formatQuantity(
    lane.kits.reduce((sum, kit) => sum + quantityOf(kit.complete), 0),
    locale
  );
  const rackEmpty = lane.kits.every((kit) => kit.complete.length === 0);

  return (
    <section
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border p-2",
        tone.lane
      )}
    >
      <header className="flex items-center gap-3 px-2 py-1">
        <span
          className={cn("size-4 shrink-0 rounded-full", tone.dot)}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{needLabels[lane.need]}</h2>
          {lane.verdict !== "ok" && (
            <div className="text-sm font-medium">
              {verdict[lane.verdict].label}
              {verdict[lane.verdict].who && (
                <span className="font-normal text-muted-foreground">
                  {" · "}
                  {verdict[lane.verdict].who}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {lane.raw.length > 0 && (
        <Tier
          label={<Trans>Raw shelf</Trans>}
          chip={worstBin ? binLabel[worstBin] : t`OK`}
          tone={worstBin ? (worstBin === "low" ? "yellow" : "red") : "green"}
        >
          {lane.kits.map((kit) => (
            <TierGroup
              key={kit.itemId}
              label={
                <Trans>
                  Parts of {names.itemReadableIds[kit.itemId] ?? t`the kit`}
                </Trans>
              }
            >
              {lane.raw
                .filter((bin) => bin.kitItemIds.includes(kit.itemId))
                .map((bin) => (
                  <RawBinLine
                    key={`${bin.itemId}:${bin.storageUnitId}`}
                    bin={bin}
                    names={names}
                  />
                ))}
            </TierGroup>
          ))}
          <TierGroup label={<Trans>Loose parts</Trans>}>
            {lane.raw
              .filter((bin) => bin.kitItemIds.length === 0)
              .map((bin) => (
                <RawBinLine
                  key={`${bin.itemId}:${bin.storageUnitId}`}
                  bin={bin}
                  names={names}
                />
              ))}
          </TierGroup>
        </Tier>
      )}

      <Tier
        label={<Trans>Kit rack</Trans>}
        chip={
          lane.kits.length === 0
            ? t`Fed directly`
            : rackEmpty
              ? t`Empty`
              : rackLow
                ? t`Low · ${kitsReady} ready`
                : t`${kitsReady} ready`
        }
        tone={
          lane.kits.length === 0
            ? "gray"
            : rackEmpty
              ? "red"
              : rackLow
                ? "yellow"
                : "green"
        }
      >
        {lane.kits.map((kit) => (
          <KitRackLine key={kit.itemId} kit={kit} names={names} />
        ))}
      </Tier>

      <Tier
        label={<Trans>Station</Trans>}
        chip={needLabels[lane.need]}
        tone={needTone[lane.need]}
      >
        {lane.kits.map((kit) => (
          <StationKitLine
            key={kit.itemId}
            kit={kit}
            workCenterId={canTransfer ? lane.workCenterId : null}
            names={names}
          />
        ))}
        {lane.kits.length > 0 && toAct.length > 0 && (
          <TierHeading>
            <Trans>Loose parts</Trans>
          </TierHeading>
        )}
        {toAct.map((row) => (
          <StationLine
            key={row.key}
            row={row}
            canTransfer={canTransfer}
            part={
              row.itemId ? (names.itemReadableIds[row.itemId] ?? null) : null
            }
            thumbnailPath={
              row.itemId ? names.itemThumbnailPaths[row.itemId] : undefined
            }
            source={
              row.source
                ? (names.storageUnitNames[row.source.storageUnitId] ?? null)
                : null
            }
            storageUnit={
              row.storageUnitId
                ? (names.storageUnitNames[row.storageUnitId] ?? null)
                : null
            }
            laneName={name}
            reference={
              row.materialRequestId
                ? (names.jobReadableIds[row.materialRequestId] ?? null)
                : row.stockTransferId
                  ? (names.stockTransferReadableIds[row.stockTransferId] ??
                    null)
                  : null
            }
          />
        ))}
      </Tier>
    </section>
  );
}

const quantityOf = (units: { quantity: number }[]) =>
  units.reduce((sum, unit) => sum + unit.quantity, 0);

/** A heading inside a tier: what is part of a kit, and what is loose. */
function TierHeading({ children }: { children: ReactNode }) {
  return (
    <li className="bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </li>
  );
}

function TierGroup({
  label,
  children
}: {
  label: ReactNode;
  children: ReactNode[];
}) {
  if (children.length === 0) return null;
  return (
    <>
      <TierHeading>{label}</TierHeading>
      {children}
    </>
  );
}

/**
 * A tier of a lane. It opens when something in it needs attention and
 * collapses to its chip when everything is ok; a tap opens or closes it.
 */
function Tier({
  label,
  chip,
  tone,
  children
}: {
  label: ReactNode;
  chip: string;
  tone: Tone;
  children: ReactNode;
}) {
  const lines = Array.isArray(children) ? children.flat() : [children];
  const hasLines = lines.some(Boolean);
  const header = (
    <>
      <span className="flex-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <Badge variant={tone}>{chip}</Badge>
    </>
  );
  if (!hasLines) {
    return (
      <div className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3">
        {header}
      </div>
    );
  }
  return (
    <details
      open={tone !== "green"}
      className="group rounded-lg border border-border bg-card"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 [&::-webkit-details-marker]:hidden">
        {header}
        <LuChevronDown
          className="size-4 text-muted-foreground group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {children}
      </ul>
    </details>
  );
}

function RawBinLine({ bin, names }: { bin: RawBin; names: Names }) {
  const { locale } = useLocale();
  const onHand = formatQuantity(bin.onHand, locale);
  const need = formatQuantity(bin.need, locale);
  const badge = {
    empty: { variant: "red", label: <Trans>Empty</Trans> },
    short: { variant: "red", label: <Trans>Short</Trans> },
    low: { variant: "yellow", label: <Trans>Low</Trans> },
    ok: { variant: "green", label: <Trans>OK</Trans> }
  } as const;
  const { variant, label } = badge[bin.status];
  const elsewhere = bin.elsewhere
    ? formatQuantity(bin.elsewhere.onHand, locale)
    : null;
  const otherBin = bin.elsewhere?.storageUnitId
    ? names.storageUnitNames[bin.elsewhere.storageUnitId]
    : null;

  const line = (
    <>
      <ItemThumbnail thumbnailPath={names.itemThumbnailPaths[bin.itemId]} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {names.itemReadableIds[bin.itemId] ?? <Trans>Unknown part</Trans>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {bin.storageUnitId ? (
            names.storageUnitNames[bin.storageUnitId]
          ) : (
            <Trans>No default bin</Trans>
          )}
          {bin.status !== "ok" &&
            (bin.elsewhere ? (
              otherBin ? (
                <Trans>
                  {" "}
                  · {elsewhere} in {otherBin}
                </Trans>
              ) : (
                <Trans> · {elsewhere} in no bin</Trans>
              )
            ) : bin.replenishing ? (
              <Trans> · On order</Trans>
            ) : (
              <Trans> · Nothing ordered</Trans>
            ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge variant={variant}>{label}</Badge>
        <span className="text-sm tabular-nums">
          {bin.need > 0 ? (
            <Trans>
              {onHand} of {need}
            </Trans>
          ) : (
            onHand
          )}
        </span>
      </div>
    </>
  );

  // A bin with a kanban opens its card in the ERP.
  return (
    <li>
      {bin.kanbanId ? (
        <a
          href={path.to.erpKanban(bin.kanbanId)}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-11 items-center gap-3 px-3 py-2 no-underline"
        >
          {line}
          <LuExternalLink
            className="size-3 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </a>
      ) : (
        <div className="flex min-h-11 items-center gap-3 px-3 py-2">{line}</div>
      )}
    </li>
  );
}

/** A kit item's slot on the rack: complete kits by serial, then the open kit
 *  jobs with what each is missing. A kit job opens in the MES to issue to. */
function KitRackLine({ kit, names }: { kit: LaneKit; names: Names }) {
  const { locale } = useLocale();
  const complete = formatQuantity(quantityOf(kit.complete), locale);
  const target =
    kit.target === null ? null : formatQuantity(kit.target, locale);
  const unitName = (id: string | null) =>
    (id && names.storageUnitNames[id]) || null;
  const count =
    target === null ? (
      <Trans>{complete} complete</Trans>
    ) : (
      <Trans>
        {complete} complete · target {target}
      </Trans>
    );

  return (
    <li className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-3">
        <ItemThumbnail thumbnailPath={names.itemThumbnailPaths[kit.itemId]} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {names.itemReadableIds[kit.itemId] ?? <Trans>Unknown part</Trans>}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {unitName(kit.storageUnitId)}
            {kit.rackGap > 0 &&
              (kit.replenishing ? (
                <Trans> · Kit job open</Trans>
              ) : (
                <Trans> · No kit job open</Trans>
              ))}
          </div>
        </div>
        {target === null || !kit.kanbanId ? (
          <span className="shrink-0 text-sm tabular-nums">{count}</span>
        ) : (
          // The rack's kanban card opens in the ERP.
          <a
            href={path.to.erpKanban(kit.kanbanId)}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 shrink-0 items-center gap-1 text-sm tabular-nums no-underline"
          >
            {count}
            <LuExternalLink
              className="size-3 text-muted-foreground"
              aria-hidden
            />
          </a>
        )}
      </div>
      {kit.complete.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {kit.complete.map((unit) => (
            <Badge
              key={`${unit.trackedEntityId}:${unit.storageUnitId}`}
              variant="green"
            >
              {unit.readableId ?? formatQuantity(unit.quantity, locale)}
              {unit.storageUnitId !== kit.storageUnitId &&
                unitName(unit.storageUnitId) &&
                ` · ${unitName(unit.storageUnitId)}`}
            </Badge>
          ))}
        </div>
      )}
      {kit.incomplete.map((job) => (
        <Link
          key={job.jobId}
          to={path.to.jobDag(job.jobId)}
          className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 py-2 no-underline"
        >
          <Badge variant={job.covered ? "yellow" : "red"} className="shrink-0">
            <Trans>Incomplete</Trans>
          </Badge>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {job.readableId}
              {unitName(job.storageUnitId) && (
                <span className="font-normal text-muted-foreground">
                  {" · "}
                  {unitName(job.storageUnitId)}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              <Trans>Missing</Trans>{" "}
              {job.missing
                .map(
                  (part) =>
                    `${formatQuantity(part.quantity, locale)}× ${names.itemReadableIds[part.itemId] ?? "?"}`
                )
                .join(", ")}
            </div>
          </div>
        </Link>
      ))}
    </li>
  );
}

/** A kit at the station: whether to bring one, the serials there, and how
 *  many open units they cover. */
function StationKitLine({
  kit,
  workCenterId,
  names
}: {
  kit: LaneKit;
  /** Null when the kit cannot be brought from here: no station, or the user
   *  may not move stock. */
  workCenterId: string | null;
  names: Names;
}) {
  const { locale } = useLocale();
  const onHand = formatQuantity(quantityOf(kit.atStation), locale);
  const covers = formatQuantity(kit.covers, locale);
  const demand = formatQuantity(kit.demand, locale);
  const badge = {
    bring: { variant: "red", label: <Trans>Bring kit</Trans> },
    out: { variant: "red", label: <Trans>No kit</Trans> },
    coming: { variant: "gray", label: <Trans>On its way</Trans> },
    ok: { variant: "green", label: <Trans>Kit</Trans> }
  } as const;
  const { variant, label } = badge[kit.stationStatus];
  return (
    <li className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-3">
        <ItemThumbnail thumbnailPath={names.itemThumbnailPaths[kit.itemId]} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {names.itemReadableIds[kit.itemId] ?? <Trans>Unknown part</Trans>}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            <Trans>
              {onHand} on hand · covers {covers} of {demand}
            </Trans>
          </div>
        </div>
        <Badge variant={variant} className="shrink-0">
          {label}
        </Badge>
      </div>
      {kit.source && workCenterId && (
        <TransferButton
          workCenterId={workCenterId}
          itemId={kit.itemId}
          source={kit.source}
          from={names.storageUnitNames[kit.source.storageUnitId] ?? null}
        />
      )}
    </li>
  );
}

function StationLine({
  row,
  canTransfer,
  part,
  thumbnailPath,
  source,
  storageUnit,
  laneName,
  reference
}: {
  row: LineFeedRow;
  canTransfer: boolean;
  part: string | null;
  thumbnailPath?: string;
  /** The name of the bin to grab a short part from. */
  source: string | null;
  /** Where a transfer is going: a station can have several storage units. */
  storageUnit: string | null;
  /** The lane's own name: a storage unit named the same is not repeated. */
  laneName: string;
  reference: string | null;
}) {
  const { locale } = useLocale();
  const quantity =
    row.quantity === null ? null : formatQuantity(row.quantity, locale);

  if (row.kind === "shortage") {
    const onHand = row.source
      ? formatQuantity(row.source.onHand, locale)
      : null;
    // Earlier stations matter only when they leave this one short.
    const claimed =
      row.source && row.source.quantity < (row.quantity ?? 0)
        ? (row.source.claimed ?? 0)
        : 0;
    const free = row.source
      ? formatQuantity(row.source.onHand - claimed, locale)
      : null;
    const unbinned = formatQuantity(row.supply?.unbinned ?? 0, locale);
    return (
      <li className="flex flex-col gap-2 px-3 py-2">
        <div className="flex items-center gap-3">
          <ItemThumbnail thumbnailPath={thumbnailPath} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {part ?? <Trans>Unknown part</Trans>}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {row.source ? (
                claimed > 0 ? (
                  <Trans>
                    Grab from {source} · {free} of {onHand} left for this
                    station
                  </Trans>
                ) : (
                  <Trans>
                    Grab from {source} · {onHand} there
                  </Trans>
                )
              ) : !row.supply ? (
                <Trans>None on the shelf</Trans>
              ) : row.supply.unbinned > 0 ? (
                <Trans>{unbinned} in stock, in no bin</Trans>
              ) : row.supply.replenishing ? (
                <Trans>None in stock · On order</Trans>
              ) : (
                <Trans>None in stock · Nothing ordered</Trans>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {row.cover === "fed" || row.cover === "site" ? (
              <Badge variant="yellow">
                <Trans>Bring</Trans>
              </Badge>
            ) : row.cover === "upstream" ? (
              <Badge variant="yellow">
                <Trans>Made here</Trans>
              </Badge>
            ) : row.cover === "none" ? (
              <Badge variant="red">
                <Trans>Short</Trans>
              </Badge>
            ) : (
              <Badge variant={row.stockStatus === "out" ? "red" : "yellow"}>
                {row.stockStatus === "out" ? (
                  <Trans>Out</Trans>
                ) : (
                  <Trans>Low</Trans>
                )}
              </Badge>
            )}
            <span className="text-sm tabular-nums">
              {row.cover === "fed" || row.cover === "site" || !row.cover ? (
                <Trans>Bring {quantity}</Trans>
              ) : (
                <Trans>Need {quantity}</Trans>
              )}
            </span>
          </div>
        </div>
        {canTransfer &&
          row.source &&
          row.source.quantity > 0 &&
          row.workCenterId &&
          row.itemId && (
            <TransferButton
              workCenterId={row.workCenterId}
              itemId={row.itemId}
              source={row.source}
              from={source}
            />
          )}
      </li>
    );
  }

  if (row.kind === "transfer" && row.stockTransferId) {
    // A transfer opens its stock transfer in the ERP; the MES has no transfer
    // screen.
    return (
      <li>
        <a
          href={path.to.erpStockTransfer(row.stockTransferId)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 px-3 py-2 no-underline"
        >
          <Badge variant="gray" className="shrink-0">
            <Trans>On its way</Trans>
          </Badge>
          <span className="min-w-0 flex-1 truncate text-sm">
            {part ?? <Trans>Unknown part</Trans>}{" "}
            {quantity && <span className="tabular-nums">× {quantity}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {storageUnit && storageUnit !== laneName && (
              <span>{storageUnit} ·</span>
            )}
            {reference}
            <LuExternalLink className="size-3" aria-hidden />
          </span>
        </a>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-3">
        <Badge variant="yellow" className="shrink-0">
          <Trans>Asked</Trans>
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {part ?? <Trans>Any part</Trans>}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {reference}
          {row.createdAt && (
            <DateTime value={row.createdAt} variant="relative" />
          )}
        </span>
      </div>
      {row.note && (
        <p className="text-sm text-muted-foreground line-clamp-2">{row.note}</p>
      )}
      {row.materialRequestId && (
        <ResolveMaterialRequestButton
          materialRequestId={row.materialRequestId}
        />
      )}
    </li>
  );
}

/**
 * Grab it, type how many, tap, carry it over: one tap moves the stock from
 * the source bin to the station's bin. The quantity starts at what the
 * station is short of; the feeder can bring more (a whole box), up to what
 * the bin holds. The server decides the destination. The action flashes what
 * happened: a move that lands removes this button before it could say so.
 */
function TransferButton({
  workCenterId,
  itemId,
  source,
  from
}: {
  workCenterId: string;
  itemId: string;
  source: StockSource;
  from: string | null;
}) {
  const { locale } = useLocale();
  const { t } = useLingui();
  const fetcher = useAction<{ success: boolean }>();
  // What the feeder typed; until then, the suggested quantity.
  const [typed, setTyped] = useState<string | null>(null);
  const entered = typed === null ? source.quantity : Number(typed);
  const valid = Number.isFinite(entered) && entered > 0;
  const quantity = valid ? formatQuantity(entered, locale) : "";
  // A kit moves one serial at a time.
  const adjustable = !source.trackedEntityId;

  return (
    <fetcher.Form
      method="post"
      action={path.to.lineFeedTransfer}
      className="flex w-full gap-2"
    >
      <input type="hidden" name="workCenterId" value={workCenterId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input
        type="hidden"
        name="fromStorageUnitId"
        value={source.storageUnitId}
      />
      {source.trackedEntityId && (
        <input
          type="hidden"
          name="trackedEntityId"
          value={source.trackedEntityId}
        />
      )}
      {adjustable ? (
        <Input
          name="quantity"
          type="number"
          inputMode="decimal"
          min={0}
          max={source.onHand}
          step="any"
          size="lg"
          value={typed ?? String(source.quantity)}
          onChange={(event) => setTyped(event.target.value)}
          aria-label={t`Quantity to move`}
          className="w-24 shrink-0 text-center tabular-nums"
        />
      ) : (
        <input type="hidden" name="quantity" value={source.quantity} />
      )}
      <Button
        type="submit"
        variant="secondary"
        size="lg"
        leftIcon={<LuArrowRightLeft />}
        isLoading={fetcher.isPending}
        isDisabled={fetcher.isPending || !valid || entered > source.onHand}
        className="min-w-0 flex-1"
      >
        {from ? (
          <Trans>
            Move {quantity} from {from}
          </Trans>
        ) : (
          <Trans>Move {quantity}</Trans>
        )}
      </Button>
    </fetcher.Form>
  );
}
