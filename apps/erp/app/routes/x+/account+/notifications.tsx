import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { companyHasPlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import {
  NotificationTopic,
  USER_FACING_NOTIFICATION_TOPICS
} from "@carbon/notifications";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Switch
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
    companyHasPlan(client, companyId, { feature: "EMAIL_NOTIFICATIONS" })
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

  // Absence of a row = enabled; in-flight toggles win over loader data.
  const isEnabled = (topic: NotificationTopic, channel: "email" | "slack") => {
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
    return row ? row.enabled : true;
  };

  // A cell with a submission in flight is disabled: overlapping upserts for
  // the same (topic, channel) would race and last-write-wins in the database.
  const isPending = (topic: NotificationTopic, channel: "email" | "slack") =>
    fetchers.some(
      (fetcher) =>
        fetcher.state !== "idle" &&
        fetcher.formData?.get("topic") === topic &&
        fetcher.formData?.get("channel") === channel
    );

  const toggle = (
    topic: NotificationTopic,
    channel: "email" | "slack",
    next: boolean
  ) => {
    submit(
      { topic, channel, enabled: String(next) },
      { method: "post", navigate: false }
    );
  };

  return (
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
            {USER_FACING_NOTIFICATION_TOPICS.map((topic) => (
              <tr key={topic} className="border-b border-border last:border-0">
                <td className="text-sm py-3">{topicLabels[topic]}</td>
                <td className="py-3 w-24">
                  <div className="flex justify-center">
                    <Switch
                      checked={isEnabled(topic, "email")}
                      disabled={isPending(topic, "email")}
                      onCheckedChange={(checked) =>
                        toggle(topic, "email", checked)
                      }
                      aria-label={`${topicLabels[topic]} ${t`email`}`}
                    />
                  </div>
                </td>
                {slackActive && (
                  <td className="py-3 w-24">
                    <div className="flex justify-center">
                      <Switch
                        checked={isEnabled(topic, "slack")}
                        disabled={isPending(topic, "slack")}
                        onCheckedChange={(checked) =>
                          toggle(topic, "slack", checked)
                        }
                        aria-label={`${topicLabels[topic]} ${t`Slack`}`}
                      />
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
