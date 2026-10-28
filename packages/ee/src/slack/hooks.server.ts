// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { IntegrationServerHooks } from "../types";
import { postSlackWelcome } from "./lib/client";

/** A new install says hello in the channel picked on the consent screen, so the
 * person can see the bot is live there. */
export const slackOnConnect: NonNullable<
  IntegrationServerHooks["onConnect"]
> = async ({ accessToken, metadata }) => {
  const channelId = metadata.channel_id;
  if (typeof channelId !== "string" || channelId === "") return;
  await postSlackWelcome({ token: accessToken, channelId });
};
