import { createHmac } from "node:crypto";

/**
 * Pure helpers for signed, curated accounting webhooks
 * (.ai/specs/2026-07-04-integration-surface.md §4).
 *
 * Kept free of Inngest/axios so they are unit-testable in isolation. The legacy
 * raw-diff webhook path (config without `registrationId`) does NOT use these.
 */

export type WebhookEventRow = Record<string, unknown> | null;

export type WebhookEvent = {
  table: string;
  operation: string;
  recordId: string;
  new: WebhookEventRow;
  old: WebhookEventRow;
  timestamp?: string;
};

export type WebhookEnvelope = {
  id: string;
  topic: string;
  companyId: string | null;
  occurredAt: string | null;
  data: Record<string, unknown>;
};

function pick(row: WebhookEventRow, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row) return out;
  for (const key of keys) {
    if (key in row) out[key] = row[key];
  }
  return out;
}

/**
 * Per-topic curated projection — ids + status, never raw row diffs or line
 * detail. Consumers pull full detail from the authenticated API.
 */
export function projectTopicData(
  topic: string,
  row: WebhookEventRow
): Record<string, unknown> {
  if (topic.startsWith("journal_entry.")) {
    return pick(row, [
      "id",
      "journalEntryId",
      "postingDate",
      "status",
      "reversalOfId",
      "reversedById",
      "externalId",
      "sourceSystem"
    ]);
  }
  if (topic.startsWith("period.")) {
    return pick(row, [
      "id",
      "fiscalYear",
      "periodNumber",
      "closeStatus",
      "startDate",
      "endDate"
    ]);
  }
  if (topic.startsWith("approval.")) {
    return pick(row, [
      "id",
      "documentType",
      "documentId",
      "status",
      "decisionBy",
      "decisionAt"
    ]);
  }
  // Unknown topic: empty projection rather than leaking the raw row.
  return {};
}

export function buildWebhookEnvelope(
  msgId: string,
  topic: string,
  event: WebhookEvent
): WebhookEnvelope {
  const row = event.new ?? event.old;
  const companyId =
    (row && typeof row["companyId"] === "string"
      ? (row["companyId"] as string)
      : null) ?? null;

  return {
    id: msgId,
    topic,
    companyId,
    occurredAt: event.timestamp ?? null,
    data: projectTopicData(topic, row)
  };
}

/**
 * `v1=<hex HMAC-SHA256(secret, `${timestamp}.${body}`)>` — mirrors the
 * paperless-parts inbound convention (timestamp-prefixed signature). Consumers
 * recompute this and reject stale timestamps (5-min replay window).
 */
export function signWebhookBody(
  secret: string,
  timestamp: string,
  body: string
): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `v1=${signature}`;
}
