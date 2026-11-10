// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  getNotificationTopicChannels,
  isNotificationTopicEnabledByDefault,
  type NotificationPreferenceChannel,
  NotificationTopic,
  USER_FACING_NOTIFICATION_TOPICS
} from "@carbon/notifications";
import { useLoaderQuery } from "@carbon/query";
import { Switch } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetchers, useSubmit } from "react-router";
import type { AccountNotificationsData } from "../types";
import {
  AccountSettingsPane,
  AccountSettingsSection
} from "./AccountSettingsLayout";
import AccountSettingsSkeleton from "./AccountSettingsSkeleton";
import { useAccountEndpoints, useAccountSettingsConfig } from "./context";

type Channel = NotificationPreferenceChannel;

export default function NotificationSettings() {
  const endpoints = useAccountEndpoints();
  const { data } = useLoaderQuery<AccountNotificationsData>(
    endpoints.notifications
  );

  return (
    <AccountSettingsPane
      title={<Trans>Notifications</Trans>}
      description={<Trans>Choose how Carbon reaches you.</Trans>}
    >
      {data ? (
        <NotificationSettingsForm {...data} />
      ) : (
        <AccountSettingsSkeleton />
      )}
    </AccountSettingsPane>
  );
}

function NotificationSettingsForm({
  preferences,
  slackActive,
  emailPlanEnabled,
  push
}: AccountNotificationsData) {
  const { renderBrowserNotifications } = useAccountSettingsConfig();
  const endpoints = useAccountEndpoints();
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
      {
        method: "post",
        action: endpoints.notifications,
        navigate: false
      }
    );
  };

  return (
    <>
      {push && renderBrowserNotifications?.(push.publicKey)}
      <AccountSettingsSection
        title={<Trans>Topics</Trans>}
        description={
          slackActive ? (
            <Trans>
              In-app notifications are always delivered. Choose which topics
              also reach you by email or Slack.
            </Trans>
          ) : (
            <Trans>
              In-app notifications are always delivered. Choose which topics
              also reach you by email.
            </Trans>
          )
        }
      >
        <div>
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
        </div>
      </AccountSettingsSection>
    </>
  );
}
