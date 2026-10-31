// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

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

/**
 * The one event Carbon acts on. Only the station id is used; any other event
 * type is acknowledged and ignored. A test delivery (`test: true`, sent by
 * Sense's "Send Test Webhook") carries a real station id and is ignored too.
 */
export const SenseWebhookEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  test: z.boolean().optional(),
  data: z
    .object({
      device_id: z.string().min(1)
    })
    .passthrough()
    .optional()
});

export const SENSE_STATUS_CHANGED = "station.status_changed";
