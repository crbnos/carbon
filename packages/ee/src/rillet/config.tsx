import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

const RilletSettingsSchema = z.object({
  apiKey: z.string().min(1, { message: "API key is required" }),
  environment: z.enum(["production", "sandbox"]).default("production"),
  subsidiaryId: z.string().optional(),
  webhookToken: z.string().optional()
});

export const Rillet = defineIntegration({
  name: "Rillet",
  id: "rillet",
  active: true,
  category: "Accounting",
  logo: Logo,
  description:
    "Integrating Carbon with Rillet posts your production and inventory journal entries, sales invoices, and bills into Rillet's multi-entity general ledger, keeps customers and vendors in sync, and applies invoice payments recorded in Rillet back to Carbon.",
  shortDescription:
    "Post journals, invoices, and bills to Rillet; pull payments back.",
  images: [],
  settingGroups: [
    {
      name: "Connection",
      description: "API access to your Rillet organization"
    },
    {
      name: "Webhooks",
      description:
        "Lets Rillet notify Carbon when invoice payments are recorded"
    }
  ],
  settings: [
    {
      name: "apiKey",
      label: "API key",
      description:
        "Create one in Rillet under Organization Settings → API access. Keys are environment-specific.",
      group: "Connection",
      type: "password" as const,
      required: true,
      value: ""
    },
    {
      name: "environment",
      label: "Environment",
      group: "Connection",
      type: "options" as const,
      listOptions: [
        {
          value: "production",
          label: "Production",
          description: "api.rillet.com"
        },
        {
          value: "sandbox",
          label: "Sandbox",
          description: "sandbox.api.rillet.com"
        }
      ],
      required: true,
      value: "production"
    },
    {
      name: "subsidiaryId",
      label: "Subsidiary ID",
      description:
        "Optional Rillet subsidiary (UUID) that journal entries, invoices, and bills post into. Leave blank for single-entity organizations.",
      group: "Connection",
      type: "text" as const,
      required: false,
      value: ""
    },
    {
      name: "webhookToken",
      label: "Webhook token",
      description:
        "Paste the Webhook Token from Rillet → Organization Settings → Webhooks after creating a webhook pointed at https://<your-carbon-host>/api/webhook/rillet/<your company ID>, subscribed to invoice payment events. Payments stay off until this is set.",
      group: "Webhooks",
      type: "password" as const,
      required: false,
      value: ""
    }
  ],
  schema: RilletSettingsSchema
});

function Logo(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
    >
      <rect
        x="2"
        y="2"
        width="36"
        height="36"
        rx="8"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="none"
      />
      <path
        d="M13 30V10h9.5a6.5 6.5 0 0 1 2.4 12.54L30.5 30h-4.9l-5.1-6.8H17V30h-4Zm4-10.2h5.3a3.1 3.1 0 1 0 0-6.2H17v6.2Z"
        fill="currentColor"
      />
    </svg>
  );
}
