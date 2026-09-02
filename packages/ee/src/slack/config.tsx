import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { startIntegrationConnect } from "../integrations/connect";
import { pieceLogo } from "../integrations/piece-logo";

export const Slack = defineIntegration({
  name: "Slack",
  id: "slack",
  category: "Assistant",
  active: CONTROLLED_ENVIRONMENT === false,
  logo: pieceLogo("slack"),
  shortDescription: "Slack for the Carbon Assistant and your workflows.",
  description:
    "One install connects your workspace for both: the Carbon Assistant (slash commands, issue threads) and workflow steps that send messages, find users and create channels. Add more accounts under Accounts if different workflows should post as different workspaces.",
  images: [],
  settings: [],
  schema: z.object({}),
  onClientInstall: () =>
    startIntegrationConnect("/api/integrations/connections/slack/connect")
});
