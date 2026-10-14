// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AccountNotificationsData } from "@carbon/account";
import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { getVapidDetails } from "@carbon/env/push.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  getNotificationPreferences,
  notificationPreferenceValidator,
  upsertNotificationPreference
} from "~/modules/account";

// Data and writes for the Notifications pane of the account settings modal.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {});

  const [preferences, slackIntegration, emailPlanEnabled] = await Promise.all([
    getNotificationPreferences(client, userId, companyId),
    // Service role: companyIntegration SELECT requires settings_view, which
    // regular employees don't have.
    getCarbonServiceRole()
      .from("companyIntegration")
      .select("active")
      .eq("companyId", companyId)
      .eq("id", "slack")
      .maybeSingle(),
    companyHasFeature(client, companyId, { feature: "EMAIL_NOTIFICATIONS" })
  ]);

  const pushKeys = getVapidDetails();

  return {
    preferences: preferences.data ?? [],
    slackActive: slackIntegration.data?.active ?? false,
    emailPlanEnabled,
    // Null hides every push control: the deployment has no push keys (no
    // SESSION_SECRET).
    push: pushKeys ? { publicKey: pushKeys.publicKey } : null
  } satisfies AccountNotificationsData;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {});

  const validation = await validator(notificationPreferenceValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { topic, channel, enabled } = validation.data;
  const upsert = await upsertNotificationPreference(client, {
    userId,
    companyId,
    topic,
    channel,
    enabled: enabled === "true"
  });

  if (upsert.error) {
    return data(
      {},
      await flash(
        request,
        error(upsert.error, "Failed to update notification preferences")
      )
    );
  }

  return {};
}
