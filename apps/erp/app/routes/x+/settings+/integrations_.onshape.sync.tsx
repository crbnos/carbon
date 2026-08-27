// Settings → Integrations → Onshape sync dashboard: what the bulk sync is doing
// now, what every part × asset ended up as, the run history, and the released
// revisions that matched no part (or several).
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Heading,
  HStack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useInterval,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuCirclePlay } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import {
  redirect,
  useFetcher,
  useLoaderData,
  useRevalidator
} from "react-router";
import { usePermissions } from "~/hooks";
import type { OnshapeReleaseException, OnshapeSyncRun } from "~/modules/items";
import {
  getOnshapeSyncCoverage,
  getOnshapeSyncItemStates,
  getOnshapeSyncRuns
} from "~/modules/items";
import { isOnshapeRunLive } from "~/modules/items/ui/Item/OnshapeSyncPresentation";
import {
  OnshapeSyncCoverage,
  OnshapeSyncItemsTable,
  OnshapeSyncReleaseExceptionsTable,
  OnshapeSyncRunCard,
  OnshapeSyncRunsTable
} from "~/modules/items/ui/OnshapeSync";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Onshape Sync`,
  to: path.to.integrationOnshapeSync()
};

// Retention caps the table at 50 runs per company, so the history tab shows all
// of it.
const RUN_HISTORY_LIMIT = 50;

// A live run writes progress continuously; anything else on the page only
// changes when someone acts on it.
const LIVE_POLL_INTERVAL_MS = 2000;

// How long the page tolerates not hearing back before it says so. Three missed
// polls, so a single slow response doesn't flicker the warning.
const POLL_SILENCE_MS = 3 * LIVE_POLL_INTERVAL_MS;

/**
 * The capped exception lists a run stores, flattened into one table's rows with
 * the reason each revision is in it. The counts of what did not fit stay
 * separate — they are a remainder, not rows.
 */
function readReleaseExceptions(
  run: OnshapeSyncRun | null
): OnshapeReleaseException[] {
  if (!run) return [];

  const read = (
    value: unknown,
    reason: OnshapeReleaseException["reason"]
  ): OnshapeReleaseException[] => {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
      const release = (entry ?? {}) as {
        partNumber?: unknown;
        revision?: unknown;
        state?: unknown;
      };
      return {
        partNumber:
          typeof release.partNumber === "string" ? release.partNumber : null,
        revision:
          typeof release.revision === "string" ? release.revision : null,
        state: typeof release.state === "string" ? release.state : null,
        reason
      };
    });
  };

  return [
    ...read(run.unmatchedReleases, "unmatched"),
    ...read(run.ambiguousReleases, "ambiguous")
  ];
}

/**
 * The columns the Items tab may sort on — every one a real column of the
 * item-state read. A `?sort=` naming anything else (bookmarked from an older
 * page, hand-typed, or written by another tab's table) is dropped rather than
 * sent to the database, where an unknown column errors the whole page.
 */
const SORTABLE_ITEM_STATE_COLUMNS = new Set([
  "itemId",
  "assetKind",
  "status",
  "revision",
  "source",
  "updatedAt",
  "updatedBy"
]);

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  // The run card's "N failed" chip and the part block's deep link both land here
  // with the Items tab narrowed; the table's own filters use `filter=` params.
  const status = searchParams.get("status");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);
  const itemStateSorts = (sorts ?? []).filter((sort) =>
    SORTABLE_ITEM_STATE_COLUMNS.has(sort.sortBy)
  );

  const [runs, itemStates, coverage] = await Promise.all([
    getOnshapeSyncRuns(client, companyId, { limit: RUN_HISTORY_LIMIT }),
    getOnshapeSyncItemStates(client, companyId, {
      search,
      status,
      limit,
      offset,
      sorts: itemStateSorts,
      filters
    }),
    getOnshapeSyncCoverage(client, companyId)
  ]);

  if (runs.error) {
    throw redirect(
      path.to.integrations,
      await flash(
        request,
        error(runs.error, "Failed to load the Onshape sync history")
      )
    );
  }

  if (itemStates.error) {
    throw redirect(
      path.to.integrations,
      await flash(
        request,
        error(itemStates.error, "Failed to load the Onshape sync items")
      )
    );
  }

  const latestRun = runs.data?.[0] ?? null;

  return {
    runs: runs.data ?? [],
    latestRun,
    itemStates: itemStates.data,
    itemStatesCount: itemStates.count,
    releaseExceptions: readReleaseExceptions(latestRun),
    unmatchedOverflow: latestRun?.unmatchedOverflow ?? 0,
    ambiguousOverflow: latestRun?.ambiguousOverflow ?? 0,
    // Coverage is a summary of the page, not the page — a failed count says so
    // in its own strip rather than redirecting the run history off screen.
    coverage: coverage.error ? ("unavailable" as const) : coverage.data
  };
}

export default function OnshapeSyncRoute() {
  const {
    runs,
    latestRun,
    itemStates,
    itemStatesCount,
    releaseExceptions,
    unmatchedOverflow,
    ambiguousOverflow,
    coverage
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const revalidator = useRevalidator();

  const startFetcher = useFetcher<{ success?: boolean; error?: string }>();

  const canStart = permissions.can("update", "settings");
  const isRunLive = isOnshapeRunLive(latestRun);
  const isStarting = startFetcher.state !== "idle";

  const startSync = () =>
    startFetcher.submit(new FormData(), {
      method: "post",
      action: path.to.api.onShapeBackfill
    });

  // The POST already revalidates this page's loader, so the new run row lands on
  // its own — this only voices the outcome.
  useEffect(() => {
    const result = startFetcher.data;
    if (!result) return;
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.success) toast.success(t`Sync started`);
  }, [startFetcher.data, t]);

  // Live runs report progress into their row, so the page just re-reads it. The
  // revalidation swaps loader data in place — the tables keep their identity,
  // and with it focus, scroll and expanded rows.
  useInterval(
    () => revalidator.revalidate(),
    isRunLive ? LIVE_POLL_INTERVAL_MS : null
  );

  // If a poll stops coming back, say so and keep the last data on screen rather
  // than emptying the page. Every completed revalidation marks the page current.
  // Both readings come off the monotonic clock: a wall-clock adjustment mid-sync
  // would otherwise either raise the warning at once or suppress it for hours.
  const [lastPollCompletedAt, setLastPollCompletedAt] = useState(() =>
    performance.now()
  );
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (revalidator.state === "idle") setLastPollCompletedAt(performance.now());
  }, [revalidator.state]);
  useInterval(
    () => setNow(performance.now()),
    isRunLive ? LIVE_POLL_INTERVAL_MS : null
  );
  const isPollingSilent =
    isRunLive && now - lastPollCompletedAt > POLL_SILENCE_MS;

  return (
    <VStack spacing={0} className="w-full h-full">
      <div className="flex px-4 py-3 items-center justify-between bg-card border-b border-border w-full">
        <VStack spacing={0}>
          <Heading size="h3">
            <Trans>Onshape sync</Trans>
          </Heading>
          {isPollingSilent && (
            <span className="text-xs text-muted-foreground">
              <Trans>Live updates paused — retrying</Trans>
            </span>
          )}
        </VStack>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="primary"
                leftIcon={<LuCirclePlay />}
                isDisabled={!canStart || isRunLive || isStarting}
                isLoading={isStarting}
                onClick={startSync}
              >
                <Trans>Start sync</Trans>
              </Button>
            </span>
          </TooltipTrigger>
          {isRunLive ? (
            <TooltipContent>
              {t`A sync is already running — cancel it before starting another`}
            </TooltipContent>
          ) : !canStart ? (
            <TooltipContent>
              {t`You do not have permission to start a sync`}
            </TooltipContent>
          ) : null}
        </Tooltip>
      </div>

      <div className="w-full px-4 py-4 md:px-6">
        <OnshapeSyncRunCard
          run={latestRun}
          canStart={canStart}
          isStarting={isStarting}
          onStart={startSync}
        />
      </div>

      <Tabs
        defaultValue="items"
        className="flex flex-col flex-1 min-h-0 w-full"
      >
        <HStack className="px-4 pb-2 md:px-6 justify-between">
          <TabsList>
            <TabsTrigger value="items">
              <Trans>Items</Trans>
            </TabsTrigger>
            <TabsTrigger value="runs">
              <Trans>Runs</Trans>
            </TabsTrigger>
            <TabsTrigger value="exceptions">
              <Trans>Release exceptions</Trans>
            </TabsTrigger>
          </TabsList>
          <OnshapeSyncCoverage coverage={coverage} />
        </HStack>

        <TabsContent value="items" className="flex-1 min-h-0">
          <OnshapeSyncItemsTable data={itemStates} count={itemStatesCount} />
        </TabsContent>
        <TabsContent value="runs" className="flex-1 min-h-0">
          <OnshapeSyncRunsTable data={runs} />
        </TabsContent>
        <TabsContent value="exceptions" className="flex-1 min-h-0">
          <OnshapeSyncReleaseExceptionsTable
            data={releaseExceptions}
            unmatchedOverflow={unmatchedOverflow}
            ambiguousOverflow={ambiguousOverflow}
          />
        </TabsContent>
      </Tabs>
    </VStack>
  );
}
