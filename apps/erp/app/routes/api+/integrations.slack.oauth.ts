import {
  SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET,
  SLACK_OAUTH_REDIRECT_URL,
  VERCEL_URL,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { Slack } from "@carbon/integrations";
import {
  createSlackApp,
  getSlackInstaller,
  slackAuthResponseSchema,
} from "@carbon/integrations/slack.server";
import { json, redirect, type LoaderFunctionArgs } from "@vercel/remix";
import z from "zod";
import { upsertIntegration } from "~/modules/settings/settings.service";

export const config = {
  runtime: "nodejs",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  const slackAuthResponse = slackAuthResponseSchema.safeParse(searchParams);

  if (!slackAuthResponse.success) {
    return json({ error: "Invalid Slack auth response" }, { status: 400 });
  }

  const { data } = slackAuthResponse;

  const veryfiedState = await getSlackInstaller().stateStore?.verifyStateParam(
    new Date(),
    data.state
  );
  const parsedMetadata = z
    .object({
      companyId: z.string(),
      userId: z.string(),
    })
    .safeParse(JSON.parse(veryfiedState?.metadata ?? "{}"));

  if (!parsedMetadata.success) {
    console.error("Invalid metadata", parsedMetadata.error.errors);
    return json({ error: "Invalid metadata" }, { status: 400 });
  }

  if (parsedMetadata.data.companyId !== companyId) {
    return json({ error: "Invalid company" }, { status: 400 });
  }

  if (parsedMetadata.data.userId !== userId) {
    return json({ error: "Invalid user" }, { status: 400 });
  }

  try {
    const slackOauthAccessUrl = [
      "https://slack.com/api/oauth.v2.access",
      `?client_id=${SLACK_CLIENT_ID}`,
      `&client_secret=${SLACK_CLIENT_SECRET}`,
      `&code=${data.code}`,
      `&redirect_uri=${SLACK_OAUTH_REDIRECT_URL}`,
    ].join("");

    const response = await fetch(slackOauthAccessUrl);
    const json = await response.json();

    const parsedJson = slackAuthResponseSchema.safeParse(json);

    if (!parsedJson.success) {
      console.error(
        "Invalid JSON response from slack",
        parsedJson.error.errors
      );
      return json(
        { error: "Failed to exchange code for token" },
        { status: 500 }
      );
    }

    const createdSlackIntegration = await upsertIntegration(client, {
      id: Slack.id,
      active: true,
      metadata: {
        access_token: data.access_token,
        team_id: data.team.id,
        team_name: data.team.name,
        channel: data.incoming_webhook.channel,
        channel_id: data.incoming_webhook.channel_id,
        slack_configuration_url: data.incoming_webhook.configuration_url,
        url: data.incoming_webhook.url,
        bot_user_id: data.bot_user_id,
      },
      updatedBy: userId,
      companyId: companyId,
    });

    if (createdSlackIntegration?.data?.metadata) {
      const slackApp = createSlackApp({
        token: data.access_token,
        botId: data.bot_user_id,
      });

      try {
        await slackApp.client.chat.postMessage({
          channel: data.incoming_webhook.channel_id,
          unfurl_links: false,
          unfurl_media: false,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "Ahoy maties! 🦜🏴‍☠️ Here be your new Cargh-bon bot. Use `/carbon` to get started.",
              },
            },
          ],
        });
      } catch (err) {
        console.error(err);
      }

      const requestUrl = new URL(request.url);

      if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
        requestUrl.protocol = "http";
      }

      return redirect(
        `${requestUrl.origin}/all-done?event=app_oauth_completed`
      );
    }
  } catch (err) {
    return json(
      { error: "Failed to exchange code for token" },
      { status: 500 }
    );
  }

  return json({ error: "Failed to exchange code for token" }, { status: 500 });
}
