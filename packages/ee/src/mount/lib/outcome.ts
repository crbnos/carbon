// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The run record each publish run keeps under `lastPublish.{entityType}`, and
 * the decisions made from it. Pure: the job and `run.ts` own the reads and
 * writes, so the rules here are testable on plain values.
 *
 * One press of a Push button is one run. A run walks the stale set in batches
 * of `MOUNT_PUBLISH_BATCH_SIZE`, one Inngest step each, and the record adds
 * every batch up so the page reports the whole run rather than its last
 * 200 records.
 */

import type { MountPublishSummary } from "./publish";
import type { MountEntityType, MountPublishRecord } from "./types";

/**
 * Batches one run takes per entity type before it stops and reports that
 * more remain: 50 × 200 = 10,000 records per press.
 */
export const MOUNT_PUBLISH_MAX_BATCHES = 50;

export type MountPublishRun = {
  runId: string;
  requestId?: string | null;
  trigger: "manual" | "schedule";
  startedAt: string;
};

export const MOUNT_ENTITY_LABELS: Record<MountEntityType, string> = {
  customer: "Customers",
  supplier: "Suppliers",
  item: "Parts"
};

/**
 * The record written before a run's first batch: running, nothing counted.
 * The deferred ids carry over — they are what sorts records that keep failing
 * behind the rest.
 */
export function startPublishRecord(
  previous: MountPublishRecord | undefined,
  run: MountPublishRun
): MountPublishRecord {
  return {
    status: "running",
    trigger: run.trigger,
    runId: run.runId,
    requestId: run.requestId ?? null,
    startedAt: run.startedAt,
    at: run.startedAt,
    created: 0,
    updated: 0,
    more: false,
    ambiguous: [],
    failed: [],
    warnings: [],
    error: null,
    deferred: previous?.deferred ?? []
  };
}

/** Whether the run stops after this batch. */
export function isFinalBatch(summary: MountPublishSummary, batch: number) {
  if (summary.failed.some((entry) => entry.entityId === "*")) return true;
  if (!summary.more) return true;
  if (batch + 1 >= MOUNT_PUBLISH_MAX_BATCHES) return true;
  // A batch that published nothing is failing for a reason the next batch
  // most likely shares — a field Mount requires, a definition deleted. Stop
  // and report rather than walk every record into the same error.
  return summary.created + summary.updated === 0;
}

/**
 * Add one batch to the run's record. Counts accumulate; the records that need
 * attention are the ones still blocked after this batch (`summary.deferred`),
 * so a record that failed in an early batch and published in a later one drops
 * off the list.
 *
 * A failure that names no record (`entityId: "*"`, e.g. a part definition slug
 * Mount does not have) stopped the batch before any record was tried. It is
 * the run's error, not a record to fix, so the run is reported as failed.
 */
export function applyBatchToRecord(
  current: MountPublishRecord,
  summary: MountPublishSummary,
  { final, at }: { final: boolean; at: string }
): MountPublishRecord {
  const blocker = summary.failed.find((entry) => entry.entityId === "*");
  const failed = summary.failed.filter((entry) => entry.entityId !== "*");
  const stuck = new Set(summary.deferred);
  const latestIds = new Set(
    [...failed, ...summary.ambiguous].map((entry) => entry.entityId)
  );
  const carried = <T extends { entityId: string }>(previous: T[]) =>
    previous.filter(
      (entry) => !latestIds.has(entry.entityId) && stuck.has(entry.entityId)
    );

  return {
    ...current,
    status: blocker ? "failed" : final ? "completed" : "running",
    at,
    created: current.created + summary.created,
    updated: current.updated + summary.updated,
    more: summary.more,
    ambiguous: [...carried(current.ambiguous), ...summary.ambiguous],
    failed: [...carried(current.failed), ...failed],
    warnings: [...new Set([...current.warnings, ...summary.warnings])],
    error: blocker?.reason ?? null,
    deferred: summary.deferred
  };
}

/**
 * The record for a run that failed outright. What the run already counted
 * stays; a run that never reached this entity type starts from nothing.
 */
export function failPublishRecord(
  current: MountPublishRecord | undefined,
  run: MountPublishRun,
  error: string,
  at: string
): MountPublishRecord {
  const base =
    current?.runId === run.runId ? current : startPublishRecord(current, run);
  return { ...base, status: "failed", error, at };
}

export function publishNeedsAttention(record: MountPublishRecord) {
  return (
    record.status === "failed" ||
    record.failed.length > 0 ||
    record.ambiguous.length > 0 ||
    record.warnings.length > 0 ||
    record.more
  );
}

/**
 * The in-app notification for the person who pressed Push, or null when the
 * run needs nothing from them. The integration page carries the detail; the
 * notification only says where to look.
 */
export function describePublishForNotification(
  records: Array<{ entityType: MountEntityType; record: MountPublishRecord }>
): { title: string; body: string } | null {
  const attention = records.filter(({ record }) =>
    publishNeedsAttention(record)
  );
  if (attention.length === 0) return null;

  const lines = attention.map(({ entityType, record }) => {
    const label = MOUNT_ENTITY_LABELS[entityType];
    if (record.status === "failed") {
      return `${label}: the push failed. ${record.error ?? ""}`.trim();
    }
    const parts = [`${record.created + record.updated} sent`];
    const blocked = record.failed.length + record.ambiguous.length;
    if (blocked > 0) {
      parts.push(
        `${blocked} ${blocked === 1 ? "record needs" : "records need"} attention`
      );
    }
    if (record.warnings.length > 0) {
      parts.push(
        `${record.warnings.length} ${record.warnings.length === 1 ? "setting" : "settings"} not found in Mount`
      );
    }
    if (record.more) parts.push("more remain");
    return `${label}: ${parts.join(", ")}.`;
  });

  return {
    title: attention.some(({ record }) => record.status === "failed")
      ? "Mount push failed"
      : "Mount push needs attention",
    body: `${lines.join(" ")} Open the Mount integration for details.`
  };
}
