// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { pushEndpointCookie } from "@carbon/auth/session.server";
import { getAppUrl, isPushConfigured } from "@carbon/env";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
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

// The carbon-push cookie names this browser's endpoint, so signing out
// (clearAuthCookies in @carbon/auth) can delete its rows.
const rememberEndpoint = async (endpoint: string) => ({
  "Set-Cookie": await pushEndpointCookie.serialize(endpoint)
});

// GET ?endpoint= — are browser notifications on in this browser for the
// signed-in user? Read-only: opening a page never claims the browser.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  if (!isPushConfigured()) return { enabled: false };

  const parsed = pushSubscriptionEndpointValidator.safeParse({
    endpoint: new URL(request.url).searchParams.get("endpoint")
  });
  if (!parsed.success) {
    return data({ error: "Invalid subscription" }, { status: 400 });
  }

  const subscription = await getPushSubscription(client, {
    userId,
    endpoint: parsed.data.endpoint
  });
  if (subscription.error) {
    logger.error("Failed to read push subscription", {
      companyId,
      error: subscription.error
    });
    return data({ error: subscription.error.message }, { status: 500 });
  }
  if (!subscription.data) return { enabled: false };

  // Re-set the cookie: a subscription saved before the cookie existed must
  // still end at sign-out.
  return data(
    { enabled: true },
    { headers: await rememberEndpoint(parsed.data.endpoint) }
  );
}

// This browser's Web Push subscription for the signed-in user.
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

      // Independent of each other, so they run together: the endpoint this
      // browser rotated away from, and other users' rows for this browser.
      // One browser has one endpoint, and only the user signed in may own it;
      // a previous user's row would otherwise block the upsert.
      const [removed, handedOver] = await Promise.all([
        oldEndpoint
          ? deletePushSubscription(client, { userId, endpoint: oldEndpoint })
          : Promise.resolve({ error: null }),
        getCarbonServiceRole()
          .from("pushSubscription")
          .delete()
          .eq("endpoint", endpoint)
          .neq("userId", userId)
      ]);
      if (removed.error) {
        logger.error("Failed to remove the rotated push subscription", {
          companyId,
          error: removed.error
        });
        return data({ error: removed.error.message }, { status: 500 });
      }
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
      return data(
        { id: saved.data.id },
        { headers: await rememberEndpoint(endpoint) }
      );
    }

    case "DELETE": {
      const parsed = pushSubscriptionEndpointValidator.safeParse(body);
      if (!parsed.success) {
        return data({ error: "Invalid subscription" }, { status: 400 });
      }
      const removed = await deletePushSubscription(client, {
        userId,
        endpoint: parsed.data.endpoint
      });
      if (removed.error) {
        logger.error("Failed to delete push subscription", {
          companyId,
          error: removed.error
        });
        return data({ error: removed.error.message }, { status: 500 });
      }
      return data(
        { ok: true },
        {
          headers: {
            "Set-Cookie": await pushEndpointCookie.serialize("", { maxAge: 0 })
          }
        }
      );
    }

    case "POST": {
      const parsed = testPushValidator.safeParse(body);
      if (!parsed.success) {
        return data({ error: "Invalid request" }, { status: 400 });
      }
      const subscription = await getPushSubscription(client, {
        userId,
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
          { error: "Browser notifications are not on in this browser" },
          { status: 404 }
        );
      }

      await trigger("send-push", {
        subscriptionId: subscription.data.id,
        userId,
        companyId,
        title: "Carbon",
        body: "Browser notifications work in this browser.",
        url: `${getAppUrl()}${path.to.notificationSettings}`,
        tag: "carbon-test"
      });
      return { ok: true };
    }

    default:
      return data({ error: "Method not allowed" }, { status: 405 });
  }
}
