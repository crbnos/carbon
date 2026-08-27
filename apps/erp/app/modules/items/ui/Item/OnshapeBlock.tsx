import {
  Badge,
  Button,
  HStack,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Suspense, useEffect, useRef } from "react";
import { LuExternalLink, LuRefreshCw } from "react-icons/lu";
import { Await, Link, useFetcher } from "react-router";
import { OnshapeStatus } from "~/components/Icons";
import { useDateFormatter } from "~/hooks";
import type { action as onshapeItemSyncAction } from "~/routes/api+/integrations.onshape.item-sync.$itemId";
import type { loader as onshapeItemSyncStateLoader } from "~/routes/api+/integrations.onshape.item-sync-state.$itemId";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type { OnshapeItemAssetState, OnshapeItemState } from "../../types";
import {
  asOnshapeSyncStatus,
  isOnshapeSyncInFlight,
  isOnshapeSyncStalled,
  OnshapeSyncStatusChip,
  OnshapeSyncUnavailableTooltip,
  onshapeDocumentUrl,
  useOnshapeSyncLabels
} from "./OnshapeSyncPresentation";

const POLL_INTERVAL_MS = 2000;

/**
 * The part sidebar's CAD sync status: which Onshape revision this part is on,
 * how each released asset last fared, who pulled it and how, plus the on-demand
 * re-pull. Long error text and sync history live on the sync dashboard.
 */
export function OnshapeBlock({
  itemId,
  state,
  className
}: {
  itemId: string;
  state?: Promise<OnshapeItemState>;
  className?: string;
}) {
  return (
    <VStack spacing={2} className={className}>
      <HStack className="w-full justify-between">
        <h3 className="text-xs text-muted-foreground">
          <Trans>Onshape revision</Trans>
        </h3>
      </HStack>
      <Suspense fallback={<Skeleton className="h-4 w-40" />}>
        <Await resolve={state}>
          {(resolved) => <OnshapeBlockBody itemId={itemId} state={resolved} />}
        </Await>
      </Suspense>
    </VStack>
  );
}

function OnshapeBlockBody({
  itemId,
  state
}: {
  itemId: string;
  state?: OnshapeItemState;
}) {
  const { t } = useLingui();
  const pullFetcher = useFetcher<typeof onshapeItemSyncAction>();
  const stateFetcher = useFetcher<typeof onshapeItemSyncStateLoader>();

  // A poll's answer supersedes the loader's — same shape, fresher.
  const currentState = stateFetcher.data ?? state;
  const model = currentState?.model ?? null;
  const drawing = currentState?.drawing ?? null;

  const isPulling =
    isOnshapeSyncInFlight(model) || isOnshapeSyncInFlight(drawing);
  const isStalled =
    isOnshapeSyncStalled(model) || isOnshapeSyncStalled(drawing);
  // Only a definite `false` blocks the pull. A viewer who cannot read the
  // integration config gets `null` and keeps today's behaviour — a tooltip built
  // on a guess would be worse than no tooltip.
  const isAssetSyncOff = currentState?.assetSyncEnabled === false;

  const loadStateRef = useRef(stateFetcher.load);
  loadStateRef.current = stateFetcher.load;

  // Refresh while a pull is in flight, and stop the moment both assets reach an
  // outcome. `isPulling` is a boolean, so the interval survives every poll.
  useEffect(() => {
    if (!isPulling) return;
    const stateUrl = path.to.api.onShapeItemSyncState(itemId);
    const poll = setInterval(
      () => loadStateRef.current(stateUrl),
      POLL_INTERVAL_MS
    );
    return () => clearInterval(poll);
  }, [isPulling, itemId]);

  useEffect(() => {
    const result = pullFetcher.data;
    if (!result) return;
    if ("error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    // The queued rows are already written — read them so the chips flip to
    // Queued without waiting for the first interval tick.
    loadStateRef.current(path.to.api.onShapeItemSyncState(itemId));
  }, [pullFetcher.data, itemId]);

  if (!currentState?.linked) {
    return (
      <span className="text-xs text-muted-foreground">
        <Trans>Not linked to Onshape</Trans>
      </span>
    );
  }

  const revision = model?.revision ?? drawing?.revision ?? null;
  const releaseState = model?.releaseState ?? drawing?.releaseState ?? null;
  const documentUrl = currentState.docLocator
    ? onshapeDocumentUrl(currentState.docLocator, currentState.onshapeBaseUrl)
    : null;
  const revisionBadge = (
    <Badge variant="secondary">
      {revision ? revision : <Trans>Revision unknown</Trans>}
    </Badge>
  );

  return (
    <>
      <HStack spacing={1} className="w-full">
        {documentUrl ? (
          <Link
            className="group flex items-center gap-1"
            to={documentUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={t`Open in Onshape`}
          >
            {revisionBadge}
            <span className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors">
              <LuExternalLink />
            </span>
          </Link>
        ) : (
          revisionBadge
        )}
        {releaseState && <OnshapeStatus status={releaseState} />}
      </HStack>

      <OnshapeAssetRow label={t`Model`} asset={model} />
      {drawing ? (
        <OnshapeAssetRow label={t`Drawing`} asset={drawing} />
      ) : (
        <span className="text-xs text-muted-foreground">
          <Trans>No drawing synced</Trans>
        </span>
      )}

      {isStalled && <OnshapeStalledLine />}

      <OnshapeAttributionLine asset={model ?? drawing} />

      <HStack className="w-full">
        {/* An in-flight pull needs no explanation — the chips above already say
            so. Released-asset sync being off is a setting, so that one gets the
            reason and the way to change it. */}
        <OnshapeSyncUnavailableTooltip
          reason={
            isAssetSyncOff
              ? t`Onshape asset sync is turned off for this company`
              : null
          }
          withSettingsLink={isAssetSyncOff}
        >
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<LuRefreshCw />}
            isDisabled={
              isAssetSyncOff || isPulling || pullFetcher.state !== "idle"
            }
            isLoading={pullFetcher.state !== "idle"}
            // The sidebar's compact buttons stay `sm`; the invisible inset keeps
            // the pull target at 44px for touch.
            className="before:absolute before:-inset-y-[10px] before:inset-x-0 before:content-['']"
            onClick={() =>
              pullFetcher.submit(new FormData(), {
                method: "post",
                action: path.to.api.onShapeItemSync(itemId)
              })
            }
          >
            <Trans>Pull from Onshape</Trans>
          </Button>
        </OnshapeSyncUnavailableTooltip>
        <Button variant="link" size="sm" asChild>
          <Link to={path.to.integrationOnshapeSync(itemId)}>
            <Trans>Sync details</Trans>
          </Link>
        </Button>
      </HStack>
    </>
  );
}

function OnshapeAssetRow({
  label,
  asset
}: {
  label: string;
  asset: OnshapeItemAssetState | null;
}) {
  const { formatRelativeTime } = useDateFormatter();
  const { skipReasonLabel, observedOnlyLabel } = useOnshapeSyncLabels();

  const status = asOnshapeSyncStatus(asset?.status);
  const syncedAt = asset ? (asset.updatedAt ?? asset.createdAt) : null;

  return (
    <VStack spacing={1}>
      <HStack spacing={2} className="w-full">
        <span className="text-xs text-muted-foreground w-14 shrink-0">
          {label}
        </span>
        {status ? (
          <OnshapeSyncStatusChip status={status} />
        ) : (
          <span className="text-xs text-muted-foreground">
            <Trans>Not synced</Trans>
          </span>
        )}
        {syncedAt && (
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(syncedAt)}
          </span>
        )}
      </HStack>
      {status === "skipped" && (
        <span className="text-xs text-muted-foreground pl-16">
          {skipReasonLabel(asset?.skipReason)}
        </span>
      )}
      {status === "failed" && asset?.error && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground pl-16 line-clamp-1 text-left">
              {asset.error}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <span className="max-w-xs">{asset.error}</span>
          </TooltipContent>
        </Tooltip>
      )}
      {asset?.observedOnly && (
        <span className="text-xs text-muted-foreground pl-16">
          {observedOnlyLabel}
        </span>
      )}
    </VStack>
  );
}

function OnshapeStalledLine() {
  const { stalledLabel } = useOnshapeSyncLabels();
  return <span className="text-xs text-muted-foreground">{stalledLabel}</span>;
}

function OnshapeAttributionLine({
  asset
}: {
  asset: OnshapeItemAssetState | null;
}) {
  const [people] = usePeople();
  const { sourceLabel } = useOnshapeSyncLabels();

  if (!asset) return null;

  const actorId = asset.updatedBy ?? asset.createdBy;
  const actorName = people.find((person) => person.id === actorId)?.name;
  const source = sourceLabel(asset.source);

  if (!actorName && !source) return null;

  return (
    <span className="text-xs text-muted-foreground">
      {actorName && <Trans>Synced by {actorName}</Trans>}
      {actorName && source ? " · " : null}
      {source}
    </span>
  );
}
