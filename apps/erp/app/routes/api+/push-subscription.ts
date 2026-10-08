// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getAppUrl, isPushConfigured } from "@carbon/env";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import {
  deletePushSubscription,
  getPushSubscription,
  pushSubscriptionEndpointValidator,
  pushSubscriptionValidator,
  upsertPushSubscription
} from "~/modules/account";
import { path } from "~/utils/path";

const logger = getLogger("erp", "push-subscription");

const testPushValidator = pushSubscriptionEndpointValidator.extend({
  intent: z.literal("test")
});

// This device's Web Push subscription for the signed-in user and company.
// PUT saves it (also from push-worker.js after a pushsubscriptionchange),
// DELETE removes it, POST { intent: "test" } sends a test push to it.
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  if (!isPushConfigured()) {
    return data({ error: "Push is not configured" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);

  switch (request.method) {
    case "PUT": {
      const parsed = pushSubscriptionValidator.safeParse(body);
      if (!parsed.success) {
        return data({ error: "Invalid subscription" }, { status: 400 });
      }
      const { endpoint, keys, oldEndpoint } = parsed.data;

      if (oldEndpoint) {
        const removed = await deletePushSubscription(client, {
          userId,
          companyId,
          endpoint: oldEndpoint
        });
        if (removed.error) {
          logger.error("Failed to remove the rotated push subscription", {
            companyId,
            error: removed.error
          });
          return data({ error: removed.error.message }, { status: 500 });
        }
      }

      // One browser has one endpoint. A previous user's rows for it would
      // keep sending their notifications to whoever uses this browser now.
      const handedOver = await getCarbonServiceRole()
        .from("pushSubscription")
        .delete()
        .eq("endpoint", endpoint)
        .neq("userId", userId);
      if (handedOver.error) {
        logger.error("Failed to remove other users' push subscriptions", {
          companyId,
          error: handedOver.error
        });
        return data({ error: handedOver.error.message }, { status: 500 });
      }

      const saved = await upsertPushSubscription(client, {
        userId,
        companyId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: request.headers.get("user-agent")
      });
      if (saved.error) {
        logger.error("Failed to save push subscription", {
          companyId,
          error: saved.error
        });
        return data({ error: saved.error.message }, { status: 500 });
      }
      return { id: saved.data.id };
    }

    case "DELETE": {
      const parsed = pushSubscriptionEndpointValidator.safeParse(body);
      if (!parsed.success) {
        return data({ error: "Invalid subscription" }, { status: 400 });
      }
      const removed = await deletePushSubscription(client, {
        userId,
        companyId,
        endpoint: parsed.data.endpoint
      });
      if (removed.error) {
        logger.error("Failed to delete push subscription", {
          companyId,
          error: removed.error
        });
        return data({ error: removed.error.message }, { status: 500 });
      }
      return { ok: true };
    }

    case "POST": {
      const parsed = testPushValidator.safeParse(body);
      if (!parsed.success) {
        return data({ error: "Invalid request" }, { status: 400 });
      }
      const subscription = await getPushSubscription(client, {
        userId,
        companyId,
        endpoint: parsed.data.endpoint
      });
      if (subscription.error) {
        logger.error("Failed to read push subscription", {
          companyId,
          error: subscription.error
        });
        return data({ error: subscription.error.message }, { status: 500 });
      }
      if (!subscription.data) {
        return data(
          { error: "Push is not on for this device" },
          { status: 404 }
        );
      }

      await trigger("send-push", {
        subscriptionId: subscription.data.id,
        companyId,
        title: "Carbon",
        body: "Push notifications work on this device.",
        url: `${getAppUrl()}${path.to.notificationSettings}`,
        tag: "carbon-test"
      });
      return { ok: true };
    }

    default:
      return data({ error: "Method not allowed" }, { status: 405 });
  }
}
