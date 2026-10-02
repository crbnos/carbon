// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET,
  SLACK_OAUTH_REDIRECT_URL,
  VERCEL_URL
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { Slack } from "@carbon/ee";
import {
  createSlackApp,
  getSlackInstaller,
  slackOAuthTokenResponseSchema
} from "@carbon/ee/slack.server";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { z } from "zod";
import { upsertCompanyIntegration } from "~/modules/settings/settings.server";
import { oAuthCallbackSchema } from "~/modules/shared";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "settings"
  });

  const url = new URL(request.url);
  const searchParams = Object.fromEntries(url.searchParams.entries());

  const slackAuthResponse = oAuthCallbackSchema.safeParse(searchParams);

  if (!slackAuthResponse.success) {
    return data({ error: "Invalid Slack auth response" }, { status: 400 });
  }
  const veryfiedState = await getSlackInstaller().stateStore?.verifyStateParam(
    new Date(),
    slackAuthResponse.data.state
  );

  const parsedMetadata = z
    .object({
      companyId: z.string(),
      userId: z.string()
    })
    .safeParse(JSON.parse(veryfiedState?.metadata ?? "{}"));

  if (!parsedMetadata.success) {
    return data({ error: "Invalid metadata" }, { status: 400 });
  }

  if (parsedMetadata.data.companyId !== companyId) {
    return data({ error: "Invalid company" }, { status: 400 });
  }

  if (parsedMetadata.data.userId !== userId) {
    return data({ error: "Invalid user" }, { status: 400 });
  }

  // Validate required environment variables
  if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET || !SLACK_OAUTH_REDIRECT_URL) {
    return data({ error: "Slack OAuth not configured" }, { status: 500 });
  }

  try {
    const body = new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code: slackAuthResponse.data.code,
      redirect_uri: SLACK_OAUTH_REDIRECT_URL
    });

    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });

    if (!response.ok) {
      return data(
        { error: "Failed to exchange code for token - HTTP error" },
        { status: 500 }
      );
    }

    const responseText = await response.text();

    let responseData;
    try {
      responseData = JSON.parse(responseText);
      // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    } catch (parseError) {
      return data(
        { error: "Invalid JSON response from Slack" },
        { status: 500 }
      );
    }

    // Check if Slack returned an error
    if (!responseData.ok) {
      return data(
        { error: `Slack OAuth error: ${responseData.error}` },
        { status: 400 }
      );
    }

    const parsedJson = slackOAuthTokenResponseSchema.safeParse(responseData);

    if (!parsedJson.success) {
      return data(
        { error: "Failed to parse Slack OAuth response" },
        { status: 500 }
      );
    }

    const { data: tokenData } = parsedJson;

    const createdSlackIntegration = await upsertCompanyIntegration(client, {
      id: Slack.id,
      active: true,
      metadata: {
        access_token: tokenData.access_token,
        team_id: tokenData.team.id,
        team_name: tokenData.team.name,
        ...(tokenData.incoming_webhook && {
          channel: tokenData.incoming_webhook.channel,
          channel_id: tokenData.incoming_webhook.channel_id,
          slack_configuration_url: tokenData.incoming_webhook.configuration_url,
          url: tokenData.incoming_webhook.url
        }),
        bot_user_id: tokenData.bot_user_id
      },
      updatedBy: userId,
      companyId: companyId
    });

    if (createdSlackIntegration?.data?.metadata) {
      const slackApp = createSlackApp({
        token: tokenData.access_token,
        botId: tokenData.bot_user_id
      });

      // Only try to post a message if we have webhook configuration
      if (tokenData.incoming_webhook?.channel_id) {
        try {
          await slackApp.client.chat.postMessage({
            channel: tokenData.incoming_webhook.channel_id,
            unfurl_links: false,
            unfurl_media: false,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "Ahoy maties! 🦜🏴‍☠️ Here be your new Cargh-bon bot. Use `/` to get started."
                }
              }
            ]
          });
          // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
        } catch (err) {
          // Silently fail if welcome message can't be posted
        }
      }

      const requestUrl = new URL(request.url);

      if (!VERCEL_URL || VERCEL_URL.includes("localhost")) {
        requestUrl.protocol = "http";
      }

      const redirectUrl = `${requestUrl.origin}${path.to.integrations}`;

      return redirect(redirectUrl);
    } else {
      return data(
        { error: "Failed to save Slack integration" },
        { status: 500 }
      );
    }
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  } catch (err) {
    return data(
      { error: "Failed to exchange code for token" },
      { status: 500 }
    );
  }
}
