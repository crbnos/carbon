// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  MOUNT_PUBLISH_ACTION_IDS,
  type MountEntityType,
  type MountPublishRecord,
  parseMountPublishRecords,
  publishNeedsAttention
} from "@carbon/ee/mount";
import { useRevalidator } from "@carbon/query";
import { toast } from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useDateFormatter } from "~/hooks";
import { path } from "~/utils/path";
import type { IntegrationActionState } from "./IntegrationForm";

const POLL_INTERVAL_MS = 3000;
/** How long a Push may wait for its run to start while no other run is busy. */
const STARTING_TIMEOUT_MS = 60_000;
const ISSUES_SHOWN = 5;

const ACTIONS = Object.entries(MOUNT_PUBLISH_ACTION_IDS) as Array<
  [MountEntityType, string]
>;

/**
 * Action states for the Mount integration's Push buttons, read from the run
 * records the publish job keeps on the integration's metadata. While a run is
 * starting or running the page revalidates, so the button and the outcome
 * follow the job without a reload.
 */
export function useMountActionStates(metadata: Record<string, unknown>) {
  const { t } = useLingui();
  const { revalidate } = useRevalidator();
  const records = useMemo(() => parseMountPublishRecords(metadata), [metadata]);

  // The request id of the run this page started, and when, per action. It
  // is what the person did here, not a copy of the loader data.
  const [started, setStarted] = useState<
    Record<string, { requestId: string; at: number }>
  >({});
  const announced = useRef(new Set<string>());

  // Advanced while polling, so the give-up check below re-runs.
  const [now, setNow] = useState(() => Date.now());

  const actionStates: Record<string, IntegrationActionState> = {};
  let polling = false;
  for (const [entityType, actionId] of ACTIONS) {
    const record = records[entityType];
    const entry = started[actionId];
    // Started here, but the job has not picked it up yet.
    const starting =
      entry !== undefined && record?.requestId !== entry.requestId;
    const running = starting || record?.status === "running";
    if (running) polling = true;

    actionStates[actionId] = {
      running,
      runningLabel: starting ? <Trans>Starting</Trans> : <Trans>Running</Trans>,
      // While a run is starting or running the button's label is the whole
      // story; the outcome shows once it ends.
      detail:
        record && !running ? (
          <MountPublishDetail entityType={entityType} record={record} />
        ) : null
    };
  }

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => {
      revalidate();
      setNow(Date.now());
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [polling, revalidate]);

  // A Push whose run never reaches the job (the job service is down, or the
  // event was lost) leaves no record to wait for, so it is given up after a
  // while. Only one run per company goes at a time, so the wait counts from
  // when the last run stopped: a Push queued behind another keeps waiting.
  const lastBusyAt = useRef(0);
  useEffect(() => {
    const busy = ACTIONS.some(
      ([entityType]) => records[entityType]?.status === "running"
    );
    if (busy) {
      lastBusyAt.current = now;
      return;
    }
    const stalled = ACTIONS.filter(([entityType, actionId]) => {
      const entry = started[actionId];
      return (
        entry !== undefined &&
        records[entityType]?.requestId !== entry.requestId &&
        now - Math.max(entry.at, lastBusyAt.current) > STARTING_TIMEOUT_MS
      );
    }).map(([, actionId]) => actionId);
    if (stalled.length === 0) return;

    toast.error(t`The push to Mount did not start. Try again.`);
    setStarted((current) => {
      const next = { ...current };
      for (const actionId of stalled) delete next[actionId];
      return next;
    });
  }, [now, records, started, t]);

  // Say when a run this page started has ended.
  useEffect(() => {
    for (const [entityType, actionId] of ACTIONS) {
      const requestId = started[actionId]?.requestId;
      const record = records[entityType];
      if (
        !requestId ||
        record?.requestId !== requestId ||
        record.status === "running" ||
        announced.current.has(requestId)
      ) {
        continue;
      }
      announced.current.add(requestId);
      if (record.status === "failed") {
        toast.error(t`The push to Mount failed`);
      } else if (publishNeedsAttention(record)) {
        toast.warning(
          t`The push to Mount finished. Some records need attention`
        );
      } else {
        toast.success(t`The push to Mount finished`);
      }
    }
  }, [records, started, t]);

  const onActionStarted = useCallback(
    (actionId: string, response: Record<string, unknown>) => {
      const requestId = response.requestId;
      if (typeof requestId !== "string") return;
      setStarted((current) => ({
        ...current,
        [actionId]: { requestId, at: Date.now() }
      }));
      revalidate();
    },
    [revalidate]
  );

  return { actionStates, onActionStarted };
}

type Issue = {
  entityId: string;
  identifier?: string | null;
  reason: string;
};

function MountPublishDetail({
  entityType,
  record
}: {
  entityType: MountEntityType;
  record: MountPublishRecord;
}) {
  const { t } = useLingui();
  const { formatDateTime } = useDateFormatter();
  const when = record.at ? formatDateTime(record.at) : "";
  const created = record.created;
  const updated = record.updated;

  const issues: Issue[] = [
    ...record.ambiguous.map((entry) => {
      const matches = entry.matches;
      return {
        entityId: entry.entityId,
        identifier: entry.identifier,
        reason: t`Mount has ${matches} records with this identifier. Delete or merge the extra ones in Mount, then push again.`
      };
    }),
    ...record.failed
  ];
  const hidden = issues.length - ISSUES_SHOWN;

  return (
    <div className="flex flex-col gap-1 text-xs">
      {record.status === "failed" ? (
        <p className="text-destructive">
          <Trans>
            Last push {when} failed: {record.error}
          </Trans>
        </p>
      ) : (
        <p className="text-muted-foreground">
          {record.trigger === "schedule" ? (
            <Trans>Last scheduled push {when}:</Trans>
          ) : (
            <Trans>Last push {when}:</Trans>
          )}{" "}
          <Trans>
            {created} created, {updated} updated.
          </Trans>
        </p>
      )}
      {record.more && (
        <p className="text-foreground">
          <Trans>More records are waiting. Push again to continue.</Trans>
        </p>
      )}
      {record.warnings.map((warning) => (
        <p key={warning} className="text-foreground">
          {warning}
        </p>
      ))}
      {issues.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-foreground">
            <Plural
              value={issues.length}
              one="# record needs attention"
              other="# records need attention"
            />
          </p>
          <ul className="flex flex-col gap-1">
            {issues.slice(0, ISSUES_SHOWN).map((issue) => (
              <li key={issue.entityId} className="text-muted-foreground">
                <IssueRecord entityType={entityType} issue={issue} />
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <p className="text-muted-foreground">
              <Plural
                value={hidden}
                one="And # more record."
                other="And # more records."
              />
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function IssueRecord({
  entityType,
  issue
}: {
  entityType: MountEntityType;
  issue: Issue;
}) {
  // A failure that stopped the whole run names no record.
  if (issue.entityId === "*") return <>{issue.reason}</>;

  const to =
    entityType === "item"
      ? path.to.part(issue.entityId)
      : entityType === "customer"
        ? path.to.customer(issue.entityId)
        : path.to.supplier(issue.entityId);

  return (
    <>
      <Link to={to} className="font-medium text-foreground underline">
        {issue.identifier ?? issue.entityId}
      </Link>
      : {issue.reason}
    </>
  );
}
