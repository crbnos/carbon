// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { useAction, useRevalidator, useTopic } from "@carbon/query";
import { Badge, Button, cn, toast } from "@carbon/react";
import { formatQuantity } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { LuCheck, LuChevronDown, LuExternalLink } from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { DateTime } from "~/components";
import { MesAppBar, MesQueueHeader } from "~/components/MesAppBar";
import { MesEmptyState } from "~/components/MesEmptyState";
import { userContext } from "~/context";
import { useRealtimeRevalidator, useUser } from "~/hooks";
import { getLineFeed } from "~/services/inventory.service";
import type {
  Lane,
  LaneKit,
  LaneSeverity,
  LaneSummary,
  LineFeedRow,
  RawBin,
  StationStockStatus
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
  storageUnitNames: Record<string, string>;
  jobReadableIds: Record<string, string>;
  stockTransferReadableIds: Record<string, string>;
};

const emptyLineFeed = {
  lanes: [] as Lane[],
  summary: { out: 0, deliver: 0, finish: 0, build: 0, rawShort: 0 },
  itemReadableIds: {},
  storageUnitNames: {},
  jobReadableIds: {},
  stockTransferReadableIds: {},
  // A failed read is not an empty queue: the screen says so and offers a retry.
  loadFailed: false,
  noLocation: false
} satisfies Names & Record<string, unknown>;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });
  const locationId = context.get(userContext)?.locationId;
  if (!locationId) return { ...emptyLineFeed, noLocation: true };

  const sort =
    new URL(request.url).searchParams.get("sort") === "worst"
      ? "worst"
      : "line";
  const lineFeed = await getLineFeed(client, { companyId, locationId, sort });
  if (lineFeed.error || !lineFeed.data) {
    logger.error("Failed to load the line feed", {
      companyId,
      locationId,
      error: lineFeed.error
    });
    return { ...emptyLineFeed, loadFailed: true };
  }

  return { ...lineFeed.data, loadFailed: false, noLocation: false };
}

type SummaryKind = keyof LaneSummary;

const summaryKinds: SummaryKind[] = [
  "out",
  "deliver",
  "finish",
  "build",
  "rawShort"
];

const inSummary = (lane: Lane, kind: SummaryKind) =>
  kind === "out" ? lane.severity === "red" : lane.work[kind] > 0;

export default function LineFeedRoute() {
  const { lanes, summary, loadFailed, noLocation, ...names } =
    useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const { t } = useLingui();

  // The sort and the highlighted summary count live in the URL, so the board
  // holds no state of its own and a link to it opens the same view.
  const [searchParams] = useSearchParams();
  const worstFirst = searchParams.get("sort") === "worst";
  const shown = summaryKinds.find((kind) => kind === searchParams.get("show"));
  const withParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    return `?${next}`;
  };

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

  const sortToggle = (
    <Button asChild variant="secondary">
      <Link to={withParam("sort", worstFirst ? null : "worst")} replace>
        {worstFirst ? <Trans>Worst first</Trans> : <Trans>Line order</Trans>}
      </Link>
    </Button>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MesAppBar title={<Trans>Line feed</Trans>} actions={sortToggle} />
      <MesQueueHeader title={<Trans>Line feed</Trans>} actions={sortToggle} />

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
          <div className="flex flex-1 min-h-0 snap-x snap-mandatory items-start gap-4 overflow-auto p-4 scroll-px-4 scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
            {lanes.map((lane) => (
              <LaneColumn
                key={lane.workCenterId ?? "none"}
                lane={lane}
                name={lane.name ?? t`No station`}
                dimmed={shown !== undefined && !inSummary(lane, shown)}
                names={names}
              />
            ))}
          </div>
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

/** The board's work by kind. A count links to the board with its lanes lit. */
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
    out: t`stations out`,
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
  red: { lane: "border-red-600/50 bg-red-500/15", dot: "bg-red-500" }
};

type Tone = "green" | "yellow" | "red" | "gray";

/**
 * One station's lane, top to bottom the way material flows: raw shelf, kit
 * rack, station. The header names what holds the lane up and who acts on it.
 */
function LaneColumn({
  lane,
  name,
  dimmed,
  names
}: {
  lane: Lane;
  name: string;
  dimmed: boolean;
  names: Names;
}) {
  const { t } = useLingui();
  const tone = laneTone[lane.severity];
  const shortParts = lane.shortItemIds
    .map((id) => names.itemReadableIds[id] ?? t`Unknown part`)
    .join(", ");
  const verdict: Record<Lane["verdict"], { label: string; who?: string }> = {
    deliver: { label: t`Deliver`, who: t`Water spider` },
    finish: { label: t`Finish kit`, who: t`Kitter` },
    build: { label: t`Build kit`, who: t`Kitter` },
    rawShort: { label: t`Raw short: ${shortParts}`, who: t`Purchasing` },
    ok: { label: t`OK` }
  };
  const stationLabel: Record<StationStockStatus, string> = {
    wet: t`Wet`,
    low: t`Running low`,
    out: t`Out`,
    unknown: t`No lineside storage`
  };
  const stationTone: Record<StationStockStatus, Tone> = {
    wet: "green",
    low: "yellow",
    out: "red",
    unknown: "gray"
  };
  const { station } = lane;

  const worstBin = (["empty", "short", "low"] as const).find((status) =>
    lane.raw.some((bin) => bin.status === status)
  );
  const binLabel = { empty: t`Empty`, short: t`Short`, low: t`Low` };
  const rackLow = lane.kits.some(
    (kit) =>
      kit.target !== null &&
      quantityOf(kit.complete) + quantityOf(kit.incomplete) < kit.target
  );

  return (
    <section
      className={cn(
        "flex w-[calc(100vw-2rem)] shrink-0 snap-start flex-col gap-2 rounded-lg border p-2 transition-opacity sm:w-[340px]",
        tone.lane,
        dimmed && "opacity-40"
      )}
    >
      <header className="flex items-center gap-3 px-2 py-1">
        <span
          className={cn("size-4 shrink-0 rounded-full", tone.dot)}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{name}</h2>
          <div className="truncate text-sm font-medium">
            {verdict[lane.verdict].label}
            {verdict[lane.verdict].who && (
              <span className="font-normal text-muted-foreground">
                {" · "}
                {verdict[lane.verdict].who}
              </span>
            )}
          </div>
        </div>
      </header>

      {lane.raw.length > 0 && (
        <Tier
          label={<Trans>Raw shelf</Trans>}
          chip={worstBin ? binLabel[worstBin] : t`OK`}
          tone={worstBin ? (worstBin === "low" ? "yellow" : "red") : "green"}
        >
          {lane.raw.map((bin) => (
            <RawBinLine
              key={`${bin.itemId}:${bin.storageUnitId}`}
              bin={bin}
              names={names}
            />
          ))}
        </Tier>
      )}

      <Tier
        label={<Trans>Kit rack</Trans>}
        chip={
          lane.kits.length === 0 ? t`Fed directly` : rackLow ? t`Low` : t`OK`
        }
        tone={lane.kits.length === 0 ? "gray" : rackLow ? "yellow" : "green"}
      >
        {lane.kits.map((kit) => (
          <KitRackLine key={kit.itemId} kit={kit} names={names} />
        ))}
      </Tier>

      <Tier
        label={<Trans>Station</Trans>}
        chip={stationLabel[station.status]}
        tone={stationTone[station.status]}
      >
        {lane.kits.map((kit) => (
          <StationKitLine key={kit.itemId} kit={kit} names={names} />
        ))}
        {station.rows.map((row) => (
          <StationLine
            key={row.key}
            row={row}
            part={
              row.itemId ? (names.itemReadableIds[row.itemId] ?? null) : null
            }
            storageUnit={
              row.storageUnitId
                ? (names.storageUnitNames[row.storageUnitId] ?? null)
                : null
            }
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

  const line = (
    <>
      <Badge variant={variant} className="shrink-0">
        {label}
      </Badge>
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
            (bin.replenishing ? (
              <Trans> · On order</Trans>
            ) : (
              <Trans> · Nothing ordered</Trans>
            ))}
        </div>
      </div>
      <span className="shrink-0 text-sm tabular-nums">
        {bin.need > 0 ? (
          <Trans>
            {onHand} of {need}
          </Trans>
        ) : (
          onHand
        )}
      </span>
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

  return (
    <li className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {names.itemReadableIds[kit.itemId] ?? <Trans>Unknown part</Trans>}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {unitName(kit.storageUnitId)}
          </div>
        </div>
        <span className="shrink-0 text-sm tabular-nums">
          {target === null ? (
            <Trans>{complete} complete</Trans>
          ) : (
            <Trans>
              {complete} complete · target {target}
            </Trans>
          )}
        </span>
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

function StationKitLine({ kit, names }: { kit: LaneKit; names: Names }) {
  const { locale } = useLocale();
  const onHand = formatQuantity(quantityOf(kit.atStation), locale);
  const covers = formatQuantity(kit.covers, locale);
  const demand = formatQuantity(kit.demand, locale);
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {names.itemReadableIds[kit.itemId] ?? <Trans>Unknown part</Trans>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {kit.atStation.map((unit) => unit.readableId).join(", ")}
        </div>
      </div>
      <span className="shrink-0 text-right text-sm tabular-nums">
        <Trans>
          {onHand} on hand · covers {covers} of {demand}
        </Trans>
      </span>
    </li>
  );
}

function StationLine({
  row,
  part,
  storageUnit,
  reference
}: {
  row: LineFeedRow;
  part: string | null;
  /** Where a transfer is going: a station can have several storage units. */
  storageUnit: string | null;
  reference: string | null;
}) {
  const { locale } = useLocale();
  const quantity =
    row.quantity === null ? null : formatQuantity(row.quantity, locale);

  if (row.kind === "shortage") {
    return (
      <li className="flex items-center gap-3 px-3 py-2">
        <Badge
          variant={row.stockStatus === "out" ? "red" : "yellow"}
          className="shrink-0"
        >
          {row.stockStatus === "out" ? <Trans>Out</Trans> : <Trans>Low</Trans>}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {part ?? <Trans>Unknown part</Trans>}
        </span>
        <span className="shrink-0 text-sm tabular-nums">
          <Trans>Bring {quantity}</Trans>
        </span>
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
            {storageUnit && <span>{storageUnit} ·</span>}
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
        <ResolveButton materialRequestId={row.materialRequestId} />
      )}
    </li>
  );
}

function ResolveButton({ materialRequestId }: { materialRequestId: string }) {
  const { t } = useLingui();
  const fetcher = useAction<{ success: boolean; message?: string }>({
    onError: (data) => toast.error(data.message ?? t`Failed to resolve request`)
  });
  const isSubmitting = fetcher.isPending;

  return (
    <fetcher.Form
      method="post"
      action={path.to.lineFeedResolve(materialRequestId)}
      className="w-full"
    >
      <Button
        type="submit"
        variant="secondary"
        size="lg"
        leftIcon={<LuCheck />}
        isLoading={isSubmitting}
        isDisabled={isSubmitting}
        className="w-full"
      >
        <Trans>Resolve</Trans>
      </Button>
    </fetcher.Form>
  );
}
