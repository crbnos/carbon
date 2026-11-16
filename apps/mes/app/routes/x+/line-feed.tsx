// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { useRevalidator } from "@carbon/query";
import { Badge, Button, cn, toast } from "@carbon/react";
import { formatQuantity } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect } from "react";
import { LuCheck, LuExternalLink } from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { DateTime } from "~/components";
import { MesAppBar, MesQueueHeader } from "~/components/MesAppBar";
import { MesEmptyState } from "~/components/MesEmptyState";
import { userContext } from "~/context";
import { getLineFeed } from "~/services/inventory.service";
import type {
  LineFeedRow,
  StationStatus,
  StationStockStatus
} from "~/services/line-feed";
import { useItems } from "~/stores";
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
    "itemLedger"
  ]
};

export const meta: MetaFunction = () => pageMeta("Line feed");

const emptyLineFeed = {
  rows: [] as LineFeedRow[],
  stations: [] as StationStatus[],
  workCenterNames: {} as Record<string, string>,
  storageUnitNames: {} as Record<string, string>,
  jobReadableIds: {} as Record<string, string>,
  stockTransferReadableIds: {} as Record<string, string>,
  // A failed read is not an empty queue: the screen says so and offers a retry.
  loadFailed: false
};

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });
  const locationId = context.get(userContext)?.locationId;
  if (!locationId) return emptyLineFeed;

  const lineFeed = await getLineFeed(client, { companyId, locationId });
  if (lineFeed.error || !lineFeed.data) {
    logger.error("Failed to load the line feed", {
      companyId,
      locationId,
      error: lineFeed.error
    });
    return { ...emptyLineFeed, loadFailed: true };
  }

  return { ...lineFeed.data, loadFailed: false };
}

export default function LineFeedRoute() {
  const {
    rows,
    stations,
    workCenterNames,
    storageUnitNames,
    jobReadableIds,
    stockTransferReadableIds,
    loadFailed
  } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const { t } = useLingui();

  const rowsByStation = new Map<string | null, LineFeedRow[]>();
  for (const row of rows) {
    const list = rowsByStation.get(row.workCenterId);
    if (list) list.push(row);
    else rowsByStation.set(row.workCenterId, [row]);
  }

  // Work for a station that is not on the board (no work center, or one that
  // is inactive or at another location) still shows, after the stations.
  const onBoard = new Set(stations.map((station) => station.workCenterId));
  const offBoard = [...rowsByStation.keys()].filter(
    (workCenterId) => workCenterId === null || !onBoard.has(workCenterId)
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MesAppBar title={<Trans>Line feed</Trans>} />
      <MesQueueHeader title={<Trans>Line feed</Trans>} />

      <div className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        {loadFailed ? (
          <MesEmptyState
            className="flex-1 w-full h-[calc(100%-var(--header-height))]"
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
        ) : stations.length > 0 || offBoard.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] items-start p-4 gap-4">
            {stations.map((station) => (
              <StationCard
                key={station.workCenterId}
                name={station.name}
                status={station.status}
                rows={rowsByStation.get(station.workCenterId) ?? []}
                storageUnitNames={storageUnitNames}
                jobReadableIds={jobReadableIds}
                stockTransferReadableIds={stockTransferReadableIds}
              />
            ))}
            {offBoard.map((workCenterId) => (
              <StationCard
                key={workCenterId ?? "none"}
                name={
                  (workCenterId && workCenterNames[workCenterId]) ||
                  t`No station`
                }
                status="unknown"
                rows={rowsByStation.get(workCenterId) ?? []}
                storageUnitNames={storageUnitNames}
                jobReadableIds={jobReadableIds}
                stockTransferReadableIds={stockTransferReadableIds}
              />
            ))}
          </div>
        ) : (
          <MesEmptyState
            className="flex-1 w-full h-[calc(100%-var(--header-height))]"
            title={<Trans>No stations at this location</Trans>}
          />
        )}
      </div>
    </div>
  );
}

const stationTone: Record<StationStockStatus, { card: string; dot: string }> = {
  wet: {
    card: "border-emerald-600/30 bg-emerald-500/15",
    dot: "bg-emerald-500"
  },
  low: { card: "border-yellow-600/40 bg-yellow-500/20", dot: "bg-yellow-500" },
  out: { card: "border-orange-600/50 bg-orange-500/25", dot: "bg-orange-500" },
  unknown: { card: "border-border bg-muted/40", dot: "bg-muted-foreground/40" }
};

/**
 * One station: green is wet, yellow is running low, orange is out. Below the
 * status, what to bring (parts out first), what the operators asked for, and
 * what is already on its way.
 */
function StationCard({
  name,
  status,
  rows,
  storageUnitNames,
  jobReadableIds,
  stockTransferReadableIds
}: {
  name: string;
  status: StationStockStatus;
  rows: LineFeedRow[];
  storageUnitNames: Record<string, string>;
  jobReadableIds: Record<string, string>;
  stockTransferReadableIds: Record<string, string>;
}) {
  const { t } = useLingui();
  const tone = stationTone[status];
  const statusLabel: Record<StationStockStatus, string> = {
    wet: t`Wet`,
    low: t`Running low`,
    out: t`Out`,
    unknown: t`No lineside storage`
  };

  const isOut = (row: LineFeedRow) => (row.onHand ?? 0) <= 0;
  const shortages = rows.filter((row) => row.kind === "shortage");
  const ordered = [
    ...shortages.filter(isOut),
    ...shortages.filter((row) => !isOut(row)),
    ...rows.filter((row) => row.kind === "request"),
    ...rows.filter((row) => row.kind === "transfer")
  ];
  const storageUnitId = shortages[0]?.storageUnitId;
  const storageUnit = storageUnitId ? storageUnitNames[storageUnitId] : null;

  return (
    <div className={cn("rounded-lg border", tone.card)}>
      <div className="flex items-center gap-3 p-4">
        <span
          className={cn("size-4 shrink-0 rounded-full", tone.dot)}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{name}</div>
          {storageUnit && (
            <div className="truncate text-xs text-muted-foreground">
              {storageUnit}
            </div>
          )}
        </div>
        <span className="shrink-0 text-sm font-medium">
          {statusLabel[status]}
        </span>
      </div>
      {ordered.length > 0 && (
        <ul className="divide-y divide-border border-t border-border rounded-b-lg bg-card">
          {ordered.map((row) => (
            <StationLine
              key={row.key}
              row={row}
              isOut={isOut(row)}
              reference={
                row.materialRequestId
                  ? (jobReadableIds[row.materialRequestId] ?? null)
                  : row.stockTransferId
                    ? (stockTransferReadableIds[row.stockTransferId] ?? null)
                    : null
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function StationLine({
  row,
  isOut,
  reference
}: {
  row: LineFeedRow;
  isOut: boolean;
  reference: string | null;
}) {
  const { locale } = useLocale();
  const [items] = useItems();
  const part = row.itemId
    ? (items.find((item) => item.id === row.itemId)?.readableIdWithRevision ??
      null)
    : null;
  const quantity =
    row.quantity === null ? null : formatQuantity(row.quantity, locale);

  if (row.kind === "shortage") {
    return (
      <li className="flex items-center gap-3 px-4 py-3">
        <Badge variant={isOut ? "orange" : "yellow"} className="shrink-0">
          {isOut ? <Trans>Out</Trans> : <Trans>Low</Trans>}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {part}
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
          className="flex items-center gap-3 px-4 py-3 no-underline"
        >
          <Badge variant="gray" className="shrink-0">
            <Trans>On its way</Trans>
          </Badge>
          <span className="min-w-0 flex-1 truncate text-sm">
            {part}{" "}
            {quantity && <span className="tabular-nums">× {quantity}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {reference}
            <LuExternalLink className="size-3" aria-hidden />
          </span>
        </a>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
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
  const fetcher = useFetcher<{ success: boolean; message?: string }>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success === false) {
      toast.error(fetcher.data.message ?? t`Failed to resolve request`);
    }
  }, [fetcher.data, t]);

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
