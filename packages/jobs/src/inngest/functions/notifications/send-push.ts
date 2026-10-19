// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getVapidDetails } from "@carbon/env/push.server";
import { getLogger } from "@carbon/logger";
import { NonRetriableError } from "inngest";
import webpush from "web-push";
import { inngest } from "../../client";
import { pushDeliveryOutcome } from "./push-outcome";

const log = getLogger("jobs", "send-push");

// A notification older than a day is old news; the bell still has it.
const PUSH_TTL_SECONDS = 86400;

export const sendPushFunction = inngest.createFunction(
  {
    id: "send-push",
    retries: 3
  },
  { event: "carbon/send-push" },
  async ({ event, step }) => {
    const { subscriptionId, userId, title, body, url, tag } = event.data;

    const vapidDetails = getVapidDetails();
    if (!vapidDetails) {
      return { skipped: "push not configured" };
    }

    const subscription = await step.run("load-subscription", async () => {
      const { data, error } = await getCarbonServiceRole()
        .from("pushSubscription")
        .select("id, endpoint, p256dh, auth")
        .eq("id", subscriptionId)
        // Only the recipient's browser: a row that changed hands since the
        // fan-out (sign-out, another user enabled it) is skipped.
        .eq("userId", userId)
        .maybeSingle();
      if (error) {
        log.error("Failed to load push subscription", {
          error,
          subscriptionId
        });
        throw error;
      }
      return data;
    });

    // Disabled, signed out or handed to another user between the fan-out and
    // this run. companyId on the event is the notification's company, not the
    // row's, so the row is matched on id and recipient only.
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
            vapidDetails
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
          case "rejected":
            // Kept: the browser replaces an old-key subscription on its next
            // page load, and the row ages out after a session's lifetime. The
            // body says which (e.g. Apple's "BadJwtToken" is our token).
            log.warn("Push service refused the signature", {
              body: err.body,
              host: new URL(subscription.endpoint).host,
              status,
              subscriptionId: subscription.id
            });
            return { gone: false, rejected: true, status };
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
          .eq("id", subscription.id);
        if (error) {
          log.error("Failed to delete a gone push subscription", {
            error,
            subscriptionId: subscription.id
          });
          throw error;
        }
      });
    }

    return sent;
  }
);
