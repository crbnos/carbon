// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SenseProvider } from "./provider";

/** Where Sense delivers a company's webhook events. */
export const senseWebhookUrl = (origin: string, companyId: string) =>
  `${origin}/api/webhook/sense/${companyId}`;

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/**
 * Verify a Sense webhook delivery. Read off real staging deliveries
 * (2026-10-28): `Sense-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is
 * the HMAC-SHA256 of `${t}.${rawBody}` keyed by the whole `whsec_…` secret.
 * Every `v1` is tried, so a header carrying more than one still verifies.
 *
 * No timestamp window: a delivery only wakes the sync of a station, which
 * re-reads its events from the Sense API, so a replay changes nothing. A
 * window would only risk refusing Sense's own retries, and enough refusals
 * disable the webhook.
 */
export function verifySenseWebhook(args: {
  signature: string | null;
  body: string;
  secret: string;
}): boolean {
  const { signature, body, secret } = args;
  if (!signature || !secret) return false;

  let timestamp: string | null = null;
  const candidates: string[] = [];
  for (const part of signature.split(",").slice(0, 10)) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && value) timestamp = value;
    if (key === "v1" && value && HEX_SHA256.test(value)) candidates.push(value);
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || candidates.length === 0) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest();
  return candidates.some((candidate) =>
    timingSafeEqual(Buffer.from(candidate, "hex"), expected)
  );
}

const SENSE_STATUS_CHANGED = "station.status_changed";

const SenseEnvelopeSchema = z.object({
  type: z.string(),
  test: z.boolean().optional()
});

const SenseStatusChangedSchema = z.object({
  data: z.object({ device_id: z.string().min(1) })
});

/**
 * Reads a verified delivery: `stationId` names the station to sync, null when
 * the delivery needs no sync. Carbon acts on one event. Any other type is
 * acknowledged whatever its `data` holds, since refusing it counts towards
 * Sense disabling the webhook. A test delivery (`test: true`, sent by Sense's
 * "Send Test Webhook") carries a real station id and is ignored too. Returns
 * null for a malformed delivery.
 */
export function readSenseEvent(
  payload: unknown
): { stationId: string | null } | null {
  const envelope = SenseEnvelopeSchema.safeParse(payload);
  if (!envelope.success) return null;
  if (envelope.data.test || envelope.data.type !== SENSE_STATUS_CHANGED) {
    return { stationId: null };
  }
  const change = SenseStatusChangedSchema.safeParse(payload);
  return change.success ? { stationId: change.data.data.device_id } : null;
}

/**
 * Brings the company's one Sense webhook to `url`, enabled and with no filters.
 * Returns whether it changed anything. The signing secret is rotated and stored
 * unless the webhook already pointed here, was enabled and Carbon holds its
 * secret: a webhook created elsewhere has a secret only its creator knows. It is
 * stored before the webhook is enabled, so the first delivery verifies.
 *
 * `repairOnly` is the sweep's mode, which runs with nobody watching. It creates
 * a missing webhook and repairs one that already points here (no secret held, or
 * disabled by Sense), and leaves the rest alone: a webhook pointing elsewhere
 * belongs to another system until someone saves the settings, and one disabled
 * with no reason was not disabled by Sense.
 */
export async function reconcileSenseWebhook({
  sense,
  url,
  hasSecret,
  repairOnly,
  storeSecret
}: {
  sense: Pick<
    SenseProvider,
    | "getWebhook"
    | "createWebhook"
    | "updateWebhook"
    | "enableWebhook"
    | "rotateWebhookSecret"
  >;
  url: string;
  hasSecret: boolean;
  repairOnly: boolean;
  storeSecret: (secret: string) => Promise<void>;
}): Promise<boolean> {
  const existing = await sense.getWebhook();
  if (!existing) {
    const { secret } = await sense.createWebhook(url);
    await storeSecret(secret);
    return true;
  }

  const pointsHere = existing.url === url;
  if (repairOnly) {
    if (!pointsHere) return false;
    if (!existing.enabled && !existing.disabled_reason) return false;
    if (existing.enabled && hasSecret) return false;
  }

  await sense.updateWebhook(existing.id, url);
  if (!pointsHere || !existing.enabled || !hasSecret) {
    const { secret } = await sense.rotateWebhookSecret(existing.id);
    await storeSecret(secret);
  }
  if (!existing.enabled) {
    await sense.enableWebhook(existing.id);
  }
  return true;
}
