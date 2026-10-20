// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { getWebhookSigningSecret } from "@carbon/ee/webhooks.server";
import axios from "axios";
import { getJobDatabaseClient } from "../../../db.ts";
import { inngest } from "../../client.ts";
import {
  signWebhookBody,
  toWebhookBody,
  WEBHOOK_SIGNATURE_HEADER,
  webhookPayloadSchema
} from "./webhook-body.ts";

const RETRIES = 3;
// A documented part of the webhook contract (docs: building/webhooks).
const WEBHOOK_TIMEOUT_MS = 30_000;

export const webhookFunction = inngest.createFunction(
  {
    id: "event-handler-webhook",
    retries: RETRIES,
    idempotency: "event.data.msgId",
    // One in-flight delivery per record, so a rapid update burst can't reorder
    // on the wire. limit must be >= 1 -- 0 is no capacity, not unlimited, and
    // parks every run in QUEUED forever.
    concurrency: {
      limit: 1,
      key: "event.data.data.table + '-' + event.data.data.recordId"
    }
  },
  { event: "carbon/event-webhook" },
  async ({ event, step, logger, attempt }) => {
    const payload = webhookPayloadSchema.parse(event.data);
    const body = toWebhookBody(
      payload.data,
      payload.companyId,
      String(payload.msgId)
    );
    const webhookId = payload.config.webhookId;

    // Commercial feature gate — WEBHOOKS is a Business/entitled feature. An
    // unentitled company keeps its subscriptions but delivery degrades to a
    // no-op (mirrors the EMAIL_NOTIFICATIONS gate in notify.ts). Do NOT throw:
    // a throw would retry and count as a delivery failure.
    const entitled = await step.run("check-webhook-plan", () =>
      companyHasFeature(getCarbonServiceRole(), payload.companyId, {
        feature: "WEBHOOKS"
      })
    );

    if (!entitled) {
      console.warn(
        `WEBHOOKS not enabled for company ${payload.companyId}; skipping webhook delivery`
      );
      return;
    }

    await step.run("send-webhook", async () => {
      // Never log payload.url or the secret — a URL may still carry a token of
      // its own. webhookId identifies the webhook without leaking either.
      logger.info(
        `Firing ${body.type} webhook ${webhookId ?? "<unknown>"} for ${payload.data.table}`
      );

      // Serialised once: the signature covers these exact bytes, and the
      // receiver verifies the raw body it is sent. Signed per attempt, so a
      // retry carries a fresh timestamp.
      const raw = JSON.stringify(body);
      const secret = webhookId
        ? await getWebhookSigningSecret(
            getJobDatabaseClient(),
            payload.companyId,
            webhookId
          )
        : null;
      if (!secret) {
        // The subscription outlived its webhook row; nothing to deliver for.
        logger.warn(
          `No signing secret for webhook ${webhookId ?? "<unknown>"}; skipping delivery`
        );
        return;
      }
      const timestamp = Math.floor(Date.now() / 1000);

      try {
        await axios.post(payload.url, raw, {
          headers: {
            "Content-Type": "application/json",
            ...payload.config.headers,
            [WEBHOOK_SIGNATURE_HEADER]: signWebhookBody(secret, raw, timestamp)
          },
          timeout: WEBHOOK_TIMEOUT_MS
        });
      } catch (err) {
        // Count one failure per event, not per attempt — otherwise retries
        // inflate errorCount 4x for a single undelivered event.
        if (webhookId && attempt >= RETRIES) {
          await getCarbonServiceRole().rpc("increment_webhook_error", {
            webhook_id: webhookId
          });
        }
        throw err;
      }

      if (webhookId) {
        await getCarbonServiceRole().rpc("increment_webhook_success", {
          webhook_id: webhookId
        });
      }
    });
  }
);
