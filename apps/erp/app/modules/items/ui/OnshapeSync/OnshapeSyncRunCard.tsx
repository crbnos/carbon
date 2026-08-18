import {
  BarProgress,
  Button,
  Card,
  CardAttribute,
  CardAttributeLabel,
  CardAttributes,
  CardContent,
  HStack,
  Status,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
  useInterval,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCirclePlay, LuTriangleAlert } from "react-icons/lu";
import { Link } from "react-router";
import { Confirm } from "~/components/Modals";
import { useDateFormatter } from "~/hooks";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type { OnshapeSyncRun } from "../../types";
import {
  asOnshapeRunStatus,
  formatOnshapeSyncDuration,
  isOnshapeRunLive,
  isOnshapeRunStalled,
  OnshapeRunStatusChip,
  useOnshapeSyncLabels
} from "../Item/OnshapeSyncPresentation";

const ELAPSED_TICK_MS = 1000;

type OnshapeSyncRunCardProps = {
  run: OnshapeSyncRun | null;
  canStart: boolean;
  isStarting: boolean;
  onStart: () => void;
};

/**
 * The one card at the top of the sync dashboard: what the latest bulk sync is
 * doing (or did), and the single action that applies to it — cancel while it
 * runs, start another once it has stopped.
 */
export function OnshapeSyncRunCard({
  run,
  canStart,
  isStarting,
  onStart
}: OnshapeSyncRunCardProps) {
  if (!run) {
    return (
      <Card>
        <CardContent className="py-6">
          <VStack spacing={2}>
            <span className="text-sm font-medium">
              <Trans>No syncs have run yet</Trans>
            </span>
            <span className="text-xs text-muted-foreground">
              <Trans>
                Start a sync to pull released Onshape models and drawings onto
                matching parts.
              </Trans>
            </span>
            {/* The page header carries the primary Start; this one is the
                in-context nudge, not a second competing call to action. */}
            <Button
              variant="secondary"
              leftIcon={<LuCirclePlay />}
              isDisabled={!canStart || isStarting}
              isLoading={isStarting}
              onClick={onStart}
            >
              <Trans>Start sync</Trans>
            </Button>
          </VStack>
        </CardContent>
      </Card>
    );
  }

  return <RunSummary run={run} isStarting={isStarting} onStart={onStart} />;
}

function RunSummary({
  run,
  isStarting,
  onStart
}: {
  run: OnshapeSyncRun;
  isStarting: boolean;
  onStart: () => void;
}) {
  const { t } = useLingui();
  const { formatRelativeTime } = useDateFormatter();
  const { runStalledLabel } = useOnshapeSyncLabels();
  const [people] = usePeople();
  const cancelDisclosure = useDisclosure();

  const status = asOnshapeRunStatus(run.status);
  const isLive = isOnshapeRunLive(run);

  // The clock only needs to tick while the run does; a finished run's duration
  // is fixed by its own timestamps.
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), isLive ? ELAPSED_TICK_MS : null);

  const startedAt = run.startedAt ?? run.createdAt;
  const finishedAt = run.finishedAt;
  const elapsedMs =
    (finishedAt ? Date.parse(finishedAt) : now) - Date.parse(startedAt);

  const skipped =
    run.skippedAlreadySynced +
    run.skippedNoItem +
    run.skippedNonModel +
    run.skippedTooLarge;

  const cancelledByName = run.cancelledBy
    ? people.find((person) => person.id === run.cancelledBy)?.name
    : null;

  const canStartNewSync = status === "failed" || status === "cancelled";

  return (
    <>
      <Card>
        <CardContent className="py-6">
          <VStack spacing={4}>
            <HStack className="w-full justify-between" spacing={2}>
              <HStack spacing={2}>
                {status && <OnshapeRunStatusChip status={status} />}
                {/* Partial success is never silent: the red chip sits beside
                    the green one and opens the parts that failed. */}
                {status === "completed" && run.failed > 0 && (
                  <Link
                    to={`${path.to.integrationOnshapeSync()}?status=failed`}
                    aria-label={t`Show the ${run.failed} parts that failed`}
                  >
                    <Status color="red">{t`${run.failed} failed`}</Status>
                  </Link>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatOnshapeSyncDuration(
                    Number.isNaN(elapsedMs) ? 0 : elapsedMs
                  )}
                </span>
              </HStack>

              {isLive ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={cancelDisclosure.onOpen}
                >
                  <Trans>Cancel sync</Trans>
                </Button>
              ) : canStartNewSync ? (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<LuCirclePlay />}
                  isDisabled={isStarting}
                  isLoading={isStarting}
                  onClick={onStart}
                >
                  <Trans>Start new sync</Trans>
                </Button>
              ) : null}
            </HStack>

            {/* A finished run collapses to its chip, duration and counters —
                a frozen bar would say nothing the counters don't. */}
            {isLive && <RunProgressBar run={run} />}

            {isOnshapeRunStalled(run, now) && (
              <HStack spacing={1}>
                <LuTriangleAlert className="size-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {runStalledLabel}
                </span>
              </HStack>
            )}

            {status === "failed" && run.error && (
              <span className="text-xs text-muted-foreground">{run.error}</span>
            )}

            {status === "cancelled" && (
              <span className="text-xs text-muted-foreground">
                {cancelledByName
                  ? t`Cancelled by ${cancelledByName}`
                  : t`Cancelled`}
                {finishedAt ? ` · ${formatRelativeTime(finishedAt)}` : null}
              </span>
            )}

            <CardAttributes>
              <RunCounter label={t`Scanned`} value={run.revisionsScanned} />
              <RunCounter label={t`Matched`} value={run.matched} />
              <RunCounter label={t`Synced`} value={run.synced} />
              <RunCounter
                label={t`Skipped`}
                value={skipped}
                breakdown={[
                  { label: t`Already synced`, value: run.skippedAlreadySynced },
                  { label: t`No matching part`, value: run.skippedNoItem },
                  { label: t`Not a model`, value: run.skippedNonModel },
                  { label: t`File too large`, value: run.skippedTooLarge }
                ]}
              />
              <RunCounter label={t`Failed`} value={run.failed} />
            </CardAttributes>
          </VStack>
        </CardContent>
      </Card>

      {cancelDisclosure.isOpen && (
        <Confirm
          action={path.to.api.onShapeBackfillCancel}
          title={t`Cancel sync`}
          text={t`Cancel this sync? Items already synced are kept. This action is recorded.`}
          confirmText={t`Cancel sync`}
          cancelText={t`Keep syncing`}
          confirmVariant="destructive"
          onCancel={cancelDisclosure.onClose}
          onSubmit={cancelDisclosure.onClose}
        >
          <input type="hidden" name="runId" value={run.id} />
        </Confirm>
      )}
    </>
  );
}

// Determinate only when Onshape told the sync how many released revisions there
// are; otherwise the bar reports "working", not a fabricated fraction.
function RunProgressBar({ run }: { run: OnshapeSyncRun }) {
  if (run.totalRevisions && run.totalRevisions > 0) {
    return (
      <BarProgress
        progress={run.revisionsScanned}
        max={run.totalRevisions}
        activeClassName="bg-primary"
      />
    );
  }

  return (
    <BarProgress
      progress={0}
      max={1}
      inactiveClassName="bg-muted animate-pulse motion-reduce:animate-none"
    />
  );
}

function RunCounter({
  label,
  value,
  breakdown
}: {
  label: string;
  value: number;
  breakdown?: { label: string; value: number }[];
}) {
  // Focusable only when there is a breakdown to read: the tooltip is the only
  // place that detail exists, and an unfocusable trigger makes it mouse-only.
  const counter = (
    <CardAttribute tabIndex={breakdown ? 0 : undefined}>
      <CardAttributeLabel>{label}</CardAttributeLabel>
      <span className="text-sm font-medium tabular-nums">
        {value.toLocaleString()}
      </span>
    </CardAttribute>
  );

  if (!breakdown) return counter;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{counter}</TooltipTrigger>
      <TooltipContent>
        <VStack spacing={0}>
          {breakdown.map((entry) => (
            <span key={entry.label} className="text-xs tabular-nums">
              {entry.label}: {entry.value.toLocaleString()}
            </span>
          ))}
        </VStack>
      </TooltipContent>
    </Tooltip>
  );
}
