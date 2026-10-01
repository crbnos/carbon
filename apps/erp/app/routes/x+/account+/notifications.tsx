// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import {
  getNotificationTopicChannels,
  isNotificationTopicEnabledByDefault,
  type NotificationPreferenceChannel,
  NotificationTopic,
  USER_FACING_NOTIFICATION_TOPICS
} from "@carbon/notifications";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Switch,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useFetchers, useLoaderData, useSubmit } from "react-router";
import {
  getNotificationPreferences,
  notificationPreferenceValidator,
  upsertNotificationPreference
} from "~/modules/account";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Notifications`,
  to: path.to.notificationSettings
};

type Channel = NotificationPreferenceChannel;

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

  return {
    preferences: preferences.data ?? [],
    slackActive: slackIntegration.data?.active ?? false,
    emailPlanEnabled
  };
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

export default function AccountNotifications() {
  const { preferences, slackActive, emailPlanEnabled } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const fetchers = useFetchers();
  const { t } = useLingui();

  // Labels live here rather than @carbon/notifications so Lingui extracts them.
  const topicLabels: Record<NotificationTopic, string> = {
    [NotificationTopic.Approval]: t`Approvals`,
    [NotificationTopic.Changelog]: t`Changelog newsletter`,
    [NotificationTopic.General]: t`General`,
    [NotificationTopic.Inventory]: t`Inventory`,
    [NotificationTopic.Items]: t`Items`,
    [NotificationTopic.Job]: t`Jobs`,
    [NotificationTopic.Maintenance]: t`Maintenance`,
    [NotificationTopic.Purchasing]: t`Purchasing`,
    [NotificationTopic.Quality]: t`Quality`,
    [NotificationTopic.Quote]: t`Quotes`,
    [NotificationTopic.Sales]: t`Sales`,
    [NotificationTopic.Suggestion]: t`Suggestions`,
    [NotificationTopic.Training]: t`Training`
  };

  // No row means the topic's default; in-flight toggles win over loader data.
  const isEnabled = (topic: NotificationTopic, channel: Channel) => {
    let pending: boolean | undefined;
    for (const fetcher of fetchers) {
      if (
        fetcher.formData?.get("topic") === topic &&
        fetcher.formData?.get("channel") === channel
      ) {
        pending = fetcher.formData.get("enabled") === "true";
      }
    }
    if (pending !== undefined) return pending;
    const row = preferences.find(
      (p) => p.topic === topic && p.channel === channel
    );
    return row ? row.enabled : isNotificationTopicEnabledByDefault(topic);
  };

  // A cell with a submission in flight is disabled: overlapping upserts for
  // the same (topic, channel) would race and last-write-wins in the database.
  const isPending = (topic: NotificationTopic, channel: Channel) =>
    fetchers.some(
      (fetcher) =>
        fetcher.state !== "idle" &&
        fetcher.formData?.get("topic") === topic &&
        fetcher.formData?.get("channel") === channel
    );

  const toggle = (
    topic: NotificationTopic,
    channel: Channel,
    next: boolean
  ) => {
    submit(
      { topic, channel, enabled: String(next) },
      { method: "post", navigate: false }
    );
  };

  return (
    <VStack spacing={4} className="pb-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Notifications</Trans>
          </CardTitle>
          <CardDescription>
            {slackActive ? (
              <Trans>
                In-app notifications are always delivered. Choose which topics
                also reach you by email or Slack.
              </Trans>
            ) : (
              <Trans>
                In-app notifications are always delivered. Choose which topics
                also reach you by email.
              </Trans>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!emailPlanEnabled && (
            <p className="text-sm text-muted-foreground mb-4">
              <Trans>
                Email notifications are not included in your company&apos;s
                current plan; email preferences will apply if they are enabled.
              </Trans>
            </p>
          )}
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-sm font-medium py-2">
                  <Trans>Topic</Trans>
                </th>
                <th className="text-center text-sm font-medium py-2 w-24">
                  <Trans>Email</Trans>
                </th>
                {slackActive && (
                  <th className="text-center text-sm font-medium py-2 w-24">
                    <Trans>Slack</Trans>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {USER_FACING_NOTIFICATION_TOPICS.map((topic) => {
                const channels = getNotificationTopicChannels(topic);
                const cell = (channel: Channel, label: string) => (
                  <td className="py-3 w-24">
                    {channels.includes(channel) && (
                      <div className="flex justify-center">
                        <Switch
                          checked={isEnabled(topic, channel)}
                          disabled={isPending(topic, channel)}
                          onCheckedChange={(checked) =>
                            toggle(topic, channel, checked)
                          }
                          aria-label={`${topicLabels[topic]} ${label}`}
                        />
                      </div>
                    )}
                  </td>
                );
                return (
                  <tr
                    key={topic}
                    className="border-b border-border last:border-0"
                  >
                    <td className="text-sm py-3">{topicLabels[topic]}</td>
                    {cell("email", t`email`)}
                    {slackActive && cell("slack", t`Slack`)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </VStack>
  );
}
