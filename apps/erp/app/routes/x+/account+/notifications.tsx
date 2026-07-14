import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { companyHasPlan } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import {
  getNotificationTopicLabel,
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
import { Trans } from "@lingui/react/macro";
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
    client
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

  return data(
    {},
    await flash(request, success("Updated notification preferences"))
  );
}

export default function AccountNotifications() {
  const { preferences, slackActive, emailPlanEnabled } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const fetchers = useFetchers();

  // A (topic, channel) is enabled unless an enabled=false row exists. An
  // in-flight toggle for the same cell wins (optimistic).
  const isEnabled = (topic: string, channel: "email" | "slack") => {
    for (const fetcher of fetchers) {
      if (
        fetcher.formData?.get("topic") === topic &&
        fetcher.formData?.get("channel") === channel
      ) {
        return fetcher.formData.get("enabled") === "true";
      }
    }
    const row = preferences.find(
      (p) => p.topic === topic && p.channel === channel
    );
    return row ? row.enabled : true;
  };

  const toggle = (topic: string, channel: "email" | "slack", next: boolean) => {
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
                <td className="text-sm py-3">
                  {getNotificationTopicLabel(topic)}
                </td>
                <td className="py-3 w-24">
                  <div className="flex justify-center">
                    <Switch
                      checked={isEnabled(topic, "email")}
                      onCheckedChange={(checked) =>
                        toggle(topic, "email", checked)
                      }
                      aria-label={`${getNotificationTopicLabel(topic)} email`}
                    />
                  </div>
                </td>
                {slackActive && (
                  <td className="py-3 w-24">
                    <div className="flex justify-center">
                      <Switch
                        checked={isEnabled(topic, "slack")}
                        onCheckedChange={(checked) =>
                          toggle(topic, "slack", checked)
                        }
                        aria-label={`${getNotificationTopicLabel(topic)} Slack`}
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
