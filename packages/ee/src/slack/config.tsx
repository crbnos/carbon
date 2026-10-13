// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { startIntegrationConnect } from "../integrations/connect";
import { pieceLogo } from "../integrations/piece-logo";
import type { ActivepiecesPiece } from "../integrations/pieces";

const PIECE: ActivepiecesPiece = "slack";
export const Slack = defineIntegration({
  name: "Slack",
  id: PIECE,
  category: "Assistant",
  active: CONTROLLED_ENVIRONMENT === false,
  logo: pieceLogo(PIECE),
  shortDescription: "Slack for the Carbon Assistant and your workflows.",
  description:
    "One install connects your workspace for both: the Carbon Assistant (slash commands, issue threads) and workflow steps that send messages, find users and create channels. Add more accounts under Accounts if different workflows should post as different workspaces.",
  images: [],
  settings: [],
  schema: z.object({}),
  onClientInstall: () =>
    startIntegrationConnect("/api/integrations/connections/slack/connect")
});
