import { Copy, Input, InputGroup, InputRightElement } from "@carbon/react";
import { isBrowser } from "@carbon/utils";
import { JIRA_CLIENT_ID } from "@carbon/auth";
import type { SVGProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { getJiraClient } from "./lib";

export const Jira = defineIntegration({
  name: "Jira",
  id: "jira",
  active: true,
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
      viewBox="0 0 65 65"
      width={200}
      height={200}
      fill="currentColor"
      {...props}
    >
      <defs>
        <linearGradient id="jira-gradient-1" x1="98.03%" y1="0.16%" x2="58.89%" y2="40.53%">
          <stop offset="0.18" stopColor="currentColor" stopOpacity="0.4" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
        <linearGradient id="jira-gradient-2" x1="100.17%" y1="0.05%" x2="55.99%" y2="44.23%">
          <stop offset="0.18" stopColor="currentColor" stopOpacity="0.4" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
      </defs>
      <path
        d="M62.75 30.02L35.58 2.85 32.5 0 12.77 19.73 1.25 31.25a1.69 1.69 0 0 0 0 2.39L20 52.11l12.5 12.5 19.73-19.73.62-.62 9.9-9.9a1.69 1.69 0 0 0 0-2.34zM32.5 42.15l-9.65-9.65 9.65-9.65 9.65 9.65z"
        fill="currentColor"
      />
      <path
        d="M32.5 22.85A13.85 13.85 0 0 1 32.4 3L12.65 22.77l9.85 9.85z"
        fill="url(#jira-gradient-1)"
      />
      <path
        d="M42.17 32.48L32.5 42.15a13.86 13.86 0 0 1 0 19.6l19.77-19.75z"
        fill="url(#jira-gradient-2)"
      />
    </svg>
  );
}

async function healthcheck(companyId: string, _: Record<string, unknown>) {
  const jira = getJiraClient();
  return await jira.healthcheck(companyId);
}
