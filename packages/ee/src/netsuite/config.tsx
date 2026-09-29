import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

const NetSuiteSettingsSchema = z.object({
  accountId: z.string().min(1),
  consumerKey: z.string(),
  consumerSecret: z.string(),
  tokenId: z.string(),
  tokenSecret: z.string(),
  subsidiaryId: z.string().optional()
});

export const NetSuite = defineIntegration({
  name: "NetSuite",
  id: "netsuite",
  active: true,
  category: "Accounting",
  providerRole: "accounting" as const,
  logo: Logo,
  setupInstructions: SetupInstructions,
  description:
    "Post Carbon's automated journal entries into NetSuite and map the chart of accounts. Customers, invoices, bills, and payments are not synced.",
  shortDescription: "Post journals to NetSuite and map accounts.",
  images: [],
  settings: [
    {
      name: "accountId",
      label: "Account ID",
      description:
        "The NetSuite account id, including the sandbox suffix if this is a sandbox (for example 1234567-sb1).",
      type: "text" as const,
      required: true,
      value: ""
    },
    {
      name: "consumerKey",
      label: "Consumer key",
      type: "secret" as const,
      required: true,
      value: ""
    },
    {
      name: "consumerSecret",
      label: "Consumer secret",
      type: "secret" as const,
      required: true,
      value: ""
    },
    {
      name: "tokenId",
      label: "Token id",
      type: "secret" as const,
      required: true,
      value: ""
    },
    {
      name: "tokenSecret",
      label: "Token secret",
      type: "secret" as const,
      required: true,
      value: ""
    },
    {
      name: "subsidiaryId",
      label: "Subsidiary ID",
      description:
        "Internal id of the subsidiary journal entries post into. Leave blank for an account that is not OneWorld.",
      type: "text" as const,
      required: false,
      value: ""
    }
  ],
  schema: NetSuiteSettingsSchema
});

function SetupInstructions() {
  return (
    <p className="text-sm text-muted-foreground">
      In NetSuite, enable token-based authentication and create an integration
      plus an access token. Paste the account id and the four token values
      below. Carbon pushes automated journals and reads the chart of accounts
      for mapping.
    </p>
  );
}

function Logo(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="currentColor"
    >
      <path d="M6 26V6h4.2l11.6 14.2V6H26v20h-4.2L10.2 11.8V26H6Z" />
    </svg>
  );
}
