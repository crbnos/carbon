import { Alert, AlertDescription, AlertTitle, Badge, cn } from "@carbon/react";
import { formatDateTime, formatDurationMilliseconds } from "@carbon/utils";
import { readWorkflowVersion } from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCircleAlert, LuCircleSlash, LuTriangle } from "react-icons/lu";
import { EmployeeAvatar, Hyperlink } from "~/components";
import { path } from "~/utils/path";
import type {
  WorkflowRunChainEntry,
  WorkflowRunDetail as WorkflowRunDetailType,
  WorkflowRunStep
} from "../../workflows.service";
import { labelText } from "../Builder/nodes/meta";
import { EntityRecordLink } from "./EntityRecordLink";
import { RunLiveUpdates } from "./RunLiveUpdates";
import { RunStatus } from "./RunStatus";
import { runOutcome } from "./runOutcome";
import { WorkflowRunSteps } from "./WorkflowRunSteps";

type WorkflowRunDetailProps = {
  run: WorkflowRunDetailType;
  steps: WorkflowRunStep[];
  chain: WorkflowRunChainEntry[] | null;
};

function HeaderRow({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function WorkflowRunDetail({
  run,
  steps,
  chain
}: WorkflowRunDetailProps) {
  const { t } = useLingui();

  const versionRow = run.workflowVersion as
    | {
        versionNumber: number;
        formatVersion: number;
        nodes: unknown;
        edges: unknown;
      }
    | null
    | undefined;

  const readResult = versionRow ? readWorkflowVersion(versionRow) : null;
  const definition = readResult?.ok ? readResult.definition : null;

  const workflowName =
    (run.workflow as { name?: string } | null)?.name ?? run.workflowId;

  const eventLabel = run.eventId
    ? (labelText(run.eventId) ?? run.eventId)
    : null;

  const isInFlight = run.status === "Queued" || run.status === "Running";
  const compacted = run.compactedAt !== null;
  const stepsPurged = steps.length === 0 && run.compactedAt !== null;
  const outcome = runOutcome(run, steps, definition);

  return (
    <div className="flex flex-col h-full overflow-auto">
      {isInFlight && <RunLiveUpdates runId={run.id} />}

      {/* Header */}
      <div className="p-4 border-b border-border space-y-4">
        {/* Top row: workflow name, version, status */}
        <div className="flex items-start gap-3 flex-wrap">
          <Hyperlink
            to={path.to.workflow(run.workflowId)}
            className="text-base font-semibold"
          >
            {workflowName}
          </Hyperlink>
          {versionRow && (
            <Badge variant="outline">v{versionRow.versionNumber}</Badge>
          )}
          <RunStatus status={run.status} />
        </div>

        <p
          className={cn(
            "text-sm",
            outcome.tone === "danger" && "text-destructive",
            outcome.tone === "warning" && "text-foreground",
            outcome.tone === "neutral" && "text-muted-foreground"
          )}
        >
          {outcome.text}
        </p>

        {readResult && !readResult.ok && (
          <p className="text-xs text-muted-foreground italic">
            <Trans>This version's definition could not be read.</Trans>
          </p>
        )}

        {/* Metadata grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <HeaderRow label={t`Owner`}>
            <EmployeeAvatar employeeId={run.ownerId} />
          </HeaderRow>

          <HeaderRow label={t`Started`}>
            {run.startedAt
              ? formatDateTime(run.startedAt)
              : run.createdAt
                ? formatDateTime(run.createdAt)
                : "—"}
          </HeaderRow>

          <HeaderRow label={t`Duration`}>
            {run.durationMs != null
              ? formatDurationMilliseconds(run.durationMs)
              : "—"}
          </HeaderRow>

          {eventLabel && <HeaderRow label={t`Trigger`}>{eventLabel}</HeaderRow>}

          {run.triggerTable && run.triggerRecordId && (
            <HeaderRow label={t`Record`}>
              <EntityRecordLink
                table={run.triggerTable}
                id={run.triggerRecordId}
              />
            </HeaderRow>
          )}

          {run.sourceEventId && (
            <HeaderRow label={t`Source event`}>
              <span className="font-mono text-xs select-all">
                {run.sourceEventId}
              </span>
            </HeaderRow>
          )}
        </div>
      </div>

      {/* Banners */}
      <div className="px-4 py-3 space-y-3">
        {run.status === "Failed" && run.error && (
          <Alert variant="destructive">
            <LuCircleAlert />
            <AlertTitle>
              <Trans>Run failed</Trans>
            </AlertTitle>
            <AlertDescription className="font-mono text-xs whitespace-pre-wrap">
              {run.error}
            </AlertDescription>
          </Alert>
        )}

        {run.status === "Blocked" && (
          <Alert variant="warning">
            <LuTriangle />
            <AlertTitle>
              <Trans>Blocked</Trans>
            </AlertTitle>
            <AlertDescription className="space-y-1">
              {run.statusReason && <p>{run.statusReason}</p>}
              {run.causedByRunId && (
                <p>
                  <Trans>Causing run: </Trans>
                  <Hyperlink to={path.to.workflowRun(run.causedByRunId)}>
                    {run.causedByRunId}
                  </Hyperlink>
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {run.status === "Skipped" && (
          <Alert>
            <LuCircleSlash />
            <AlertTitle>
              <Trans>Skipped</Trans>
            </AlertTitle>
            {run.statusReason && (
              <AlertDescription>{run.statusReason}</AlertDescription>
            )}
          </Alert>
        )}

        {/* Chain */}
        {run.rootRunId && chain && chain.length > 1 && (
          <div className="rounded-lg border border-border p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              <Trans>Run chain</Trans>
            </p>
            {chain.map((entry) => {
              const isCurrent = entry.id === run.id;
              const entryName =
                (entry.workflow as { name?: string } | null)?.name ?? entry.id;
              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-2"
                  style={{ paddingLeft: `${entry.depth * 16}px` }}
                >
                  <RunStatus status={entry.status} />
                  {isCurrent ? (
                    <span className="text-sm font-medium">{entryName}</span>
                  ) : (
                    <Hyperlink
                      to={path.to.workflowRun(entry.id)}
                      className="text-sm"
                    >
                      {entryName}
                    </Hyperlink>
                  )}
                  {isCurrent && (
                    <Badge variant="outline" className="text-xs">
                      <Trans>current</Trans>
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Step list */}
      <div className="flex-1 min-h-0">
        <WorkflowRunSteps
          steps={steps}
          definition={definition}
          compacted={compacted}
          stepsPurged={stepsPurged}
        />
      </div>
    </div>
  );
}
