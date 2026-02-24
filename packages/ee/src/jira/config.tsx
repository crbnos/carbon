import { JIRA_CLIENT_ID } from "@carbon/auth";
import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { getJiraClient } from "./lib";

export const Jira = defineIntegration({
  name: "Jira",
  id: "jira",
  active: !!JIRA_CLIENT_ID,
  category: "Project Management",
  logo: Logo,
  description:
    "Jira is a project management and issue tracking tool by Atlassian. With this integration, you can link quality issues from Carbon to Jira for tracking and collaboration.",
  shortDescription: "Sync quality issues from Carbon to Jira.",
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
  onHealthcheck: healthcheck,
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

export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      {...props}
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <title>atlassian_jira</title>
      <rect width="24" height="24" fill="none" />
      <path d="M11.53,2a4.37,4.37,0,0,0,4.35,4.35h1.78v1.7A4.35,4.35,0,0,0,22,12.4V2.84A.85.85,0,0,0,21.16,2H11.53M6.77,6.8a4.36,4.36,0,0,0,4.34,4.34h1.8v1.72a4.36,4.36,0,0,0,4.34,4.34V7.63a.84.84,0,0,0-.83-.83H6.77M2,11.6a4.34,4.34,0,0,0,4.35,4.34H8.13v1.72A4.36,4.36,0,0,0,12.47,22V12.43a.85.85,0,0,0-.84-.84H2Z" />
    </svg>
  );
}

async function healthcheck(companyId: string, _: Record<string, unknown>) {
  const jira = getJiraClient();
  return await jira.healthcheck(companyId);
}
