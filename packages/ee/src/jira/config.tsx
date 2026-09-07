import { JIRA_CLIENT_ID } from "@carbon/auth";
import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { pieceLogo } from "../integrations/piece-logo";

export const Jira = defineIntegration({
  name: "Jira",
  id: "jira",
  active: !!JIRA_CLIENT_ID,
  category: "Project Management",
  logo: pieceLogo("jira"),
  description:
    "Jira is a project management and issue tracking tool by Atlassian. With this integration, you can link quality issues and change notices from Carbon to Jira for tracking and collaboration.",
  shortDescription:
    "Sync quality issues and change notices from Carbon to Jira.",
  setupInstructions: SetupInstructions,
  images: [],
  settings: [],
  oauth: {
    authUrl: "https://auth.atlassian.com/authorize",
    clientId: JIRA_CLIENT_ID!,
    redirectUri: "/api/integrations/jira/oauth",
    scopes: [
      "read:jira-user",
      "read:jira-work",
      "write:jira-work",
      "offline_access"
    ],
    tokenUrl: "https://auth.atlassian.com/oauth/token"
  },
  schema: z.object({})
});

function SetupInstructions({ companyId }: { companyId: string }) {
  const webhookUrl = isBrowser
    ? `${window.location.origin}/api/webhook/jira/${companyId}`
    : "";

  return (
    <>
      <p className="text-sm text-muted-foreground">
        To integrate Jira with Carbon, click the "Connect" button above to
        authorize Carbon with your Atlassian account.
      </p>
      <p className="text-sm text-muted-foreground">
        After connecting, you can optionally set up a webhook in Jira to receive
        real-time updates when issues change. Go to your Jira settings, then
        System → WebHooks, and create a new webhook with the URL below.
      </p>
      <InputGroup className="mb-8">
        <Input value={webhookUrl} readOnly />
        <InputRightElement>
          <Copy text={webhookUrl} />
        </InputRightElement>
      </InputGroup>
      <p className="text-sm text-muted-foreground">
        Select the following events: Issue updated, Issue deleted.
      </p>
    </>
  );
}
