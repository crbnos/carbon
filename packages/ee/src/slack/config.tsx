// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { definePieceIntegration } from "../integrations/piece-integration";

export const Slack = definePieceIntegration("slack", {
  name: "Slack",
  category: "Assistant",
  active: CONTROLLED_ENVIRONMENT === false,
  shortDescription: "Slack for the Carbon Assistant and your workflows.",
  description:
    "One install connects your workspace for both: the Carbon Assistant (slash commands, issue threads) and workflow steps that send messages, find users and create channels. Add more accounts under Accounts if different workflows should post as different workspaces."
});
