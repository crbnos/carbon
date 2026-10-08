// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  isPushConfigured,
  VAPID_PRIVATE_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_SUBJECT
} from "@carbon/env";
import { NonRetriableError } from "inngest";
import webpush from "web-push";
import { inngest } from "../../client";
import { pushDeliveryOutcome } from "./push-outcome";

// A notification older than a day is old news; the bell still has it.
const PUSH_TTL_SECONDS = 86400;

export const sendPushFunction = inngest.createFunction(
  {
    id: "send-push",
    retries: 3
  },
  { event: "carbon/send-push" },
  async ({ event, step }) => {
    const { subscriptionId, companyId, title, body, url, tag } = event.data;

    if (!isPushConfigured()) {
      return { skipped: "push not configured" };
    }

    const subscription = await step.run("load-subscription", async () => {
      const { data, error } = await getCarbonServiceRole()
        .from("pushSubscription")
        .select("id, endpoint, p256dh, auth")
        .eq("id", subscriptionId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (error) {
        console.error("Failed to load push subscription", error);
        throw error;
      }
      return data;
    });

    // Turned off or signed out between the fan-out and this run.
    if (!subscription) {
      return { skipped: "subscription not found" };
    }

    const sent = await step.run("send-push", async () => {
      try {
        const result = await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { auth: subscription.auth, p256dh: subscription.p256dh }
          },
          JSON.stringify({ body, tag, title, url }),
          {
            TTL: PUSH_TTL_SECONDS,
            urgency: "normal",
            vapidDetails: {
              privateKey: VAPID_PRIVATE_KEY as string,
              publicKey: VAPID_PUBLIC_KEY as string,
              subject: VAPID_SUBJECT as string
            }
          }
        );
        return { gone: false, status: result.statusCode };
      } catch (err) {
        // No status code: the request never reached the push service (DNS,
        // reset), so let Inngest retry.
        if (!(err instanceof webpush.WebPushError)) throw err;
        const status = err.statusCode;
        switch (pushDeliveryOutcome(status)) {
          case "gone":
            return { gone: true, status };
          case "retry":
            throw new Error(`Push service returned ${status}; retrying`);
          default:
            throw new NonRetriableError(
              `Push service refused the request (${status}): ${err.body}`
            );
        }
      }
    });

    // 404 / 410: the browser dropped the subscription (permission revoked,
    // site data cleared, signed out) — it never comes back.
    if (sent.gone) {
      await step.run("delete-subscription", async () => {
        const { error } = await getCarbonServiceRole()
          .from("pushSubscription")
          .delete()
          .eq("id", subscription.id)
          .eq("companyId", companyId);
        if (error) {
          console.error("Failed to delete a gone push subscription", error);
          throw error;
        }
      });
    }

    return sent;
  }
);
