// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import {
  revealWebhookSigningSecret,
  rotateWebhookSigningSecret
} from "@carbon/ee/webhooks.server";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "webhook-signing-secret");

export type WebhookSigningSecretResponse =
  | { secret: string; error: null }
  | { secret: null; error: string };

// A credential: never cached, and only for people who can change settings.
const noStore = { headers: { "Cache-Control": "no-store" } };

async function respond(
  run: () => Promise<
    { data: string; error: null } | { data: null; error: { message: string } }
  >,
  context: { companyId: string; webhookId: string }
) {
  try {
    const result = await run();
    if (result.error) {
      logger.error("Failed to read a webhook signing secret", {
        ...context,
        error: result.error
      });
      return data<WebhookSigningSecretResponse>(
        { secret: null, error: result.error.message },
        noStore
      );
    }
    return data<WebhookSigningSecretResponse>(
      { secret: result.data, error: null },
      noStore
    );
  } catch (err) {
    if (err instanceof EntitlementError) {
      return data<WebhookSigningSecretResponse>(
        { secret: null, error: "Webhooks are not included in your plan" },
        noStore
      );
    }
    throw err;
  }
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });
  const webhookId = params.id;
  if (!webhookId) throw new Error("Could not find id");

  return respond(
    () =>
      revealWebhookSigningSecret(client, getDatabaseClient(), {
        companyId,
        webhookId
      }),
    { companyId, webhookId }
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });
  const webhookId = params.id;
  if (!webhookId) throw new Error("Could not find id");

  return respond(
    () =>
      rotateWebhookSigningSecret(client, getDatabaseClient(), {
        companyId,
        webhookId
      }),
    { companyId, webhookId }
  );
}
