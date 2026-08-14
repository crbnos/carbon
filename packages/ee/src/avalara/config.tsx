import { AVALARA_ACCOUNT_ID } from "@carbon/auth";
import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";

// This file is bundled for the browser — it must never import server code
// (service.server.ts, hooks.server.ts, or lib/client.ts). Only the non-secret
// account id is read here (and it is exposed via getBrowserEnv), never the
// license key.

const coerceBoolean = z.preprocess(
  (v) =>
    v === "true" || v === "on" ? true : v === "false" || v === "" ? false : v,
  z.boolean()
);

export const AvalaraSettingsSchema = z.object({
  // Avalara company code this Carbon company maps to. Options are populated
  // dynamically from GET /api/v2/companies (see the integrations.$id loader).
  companyCode: z.string().min(1, { message: "Company code is required" }),
  // Selects the base URLs for both API surfaces. Sandbox by default.
  environment: z.enum(["sandbox", "production"]).default("sandbox"),
  // Feature toggle consumed by the tax determination connector (#1044).
  taxDetermination: coerceBoolean.optional().default(false),
  // Feature toggle consumed by the e-invoicing flows (#1054).
  eInvoicing: coerceBoolean.optional().default(false),
  // Numeric Avalara company id resolved from companyCode by the install hook.
  // Not a form field — written server-side, needed by ListNexus.
  avalaraCompanyId: z.coerce.number().optional()
});

export type AvalaraSettings = z.infer<typeof AvalaraSettingsSchema>;

export const Avalara = defineIntegration({
  name: "Avalara",
  id: "avalara",
  // Hidden unless the account id is present. The account id is non-secret and
  // browser-safe (like an OAuth client id); the license key is server-only, so
  // `active` gates on the account id and the healthcheck proves the key.
  active: !!AVALARA_ACCOUNT_ID,
  category: "Tax & Compliance",
  logo: Logo,
  description:
    "Connect Carbon to Avalara for automated US sales-tax determination and EU e-invoicing clearance. One credential set and company mapping powers both capabilities, each gated by an independent feature toggle.",
  shortDescription:
    "Automated sales-tax calculation and e-invoicing through Avalara.",
  images: [],
  settingGroups: [
    {
      name: "Connection",
      description:
        "Which Avalara company and environment this Carbon company uses"
    },
    {
      name: "Features",
      description: "Enable the Avalara capabilities this company consumes"
    }
  ],
  settings: [
    {
      name: "companyCode",
      label: "Company Code",
      description:
        "The Avalara company this Carbon company maps to (from your Avalara account)",
      group: "Connection",
      type: "options" as const,
      listOptions: [], // Populated dynamically from Avalara
      required: true,
      value: ""
    },
    {
      name: "environment",
      label: "Environment",
      description: "Use the Avalara sandbox until you are ready to go live",
      group: "Connection",
      type: "options" as const,
      listOptions: [
        {
          value: "sandbox",
          label: "Sandbox",
          description: "Test against Avalara's sandbox — no real documents"
        },
        {
          value: "production",
          label: "Production",
          description: "Live Avalara account — taxes and files real documents"
        }
      ],
      required: true,
      value: "sandbox"
    },
    {
      name: "taxDetermination",
      label: "Tax Determination",
      description:
        "Calculate sales tax on quotes, orders, and invoices via AvaTax",
      group: "Features",
      type: "switch" as const,
      required: false,
      value: false
    },
    {
      name: "eInvoicing",
      label: "E-Invoicing",
      description:
        "Submit invoices to Avalara for e-invoicing clearance and network delivery",
      group: "Features",
      type: "switch" as const,
      required: false,
      value: false
    }
  ],
  schema: AvalaraSettingsSchema,
  actions: [
    {
      id: "test-connection",
      label: "Test Connection",
      description: "Verify credentials and company code against Avalara",
      endpoint: "/api/integrations/avalara/test"
    }
  ]
});

function Logo(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="40" height="40" rx="8" fill="#FF6A00" />
      <path
        d="M20 9L29 31H24.7L23.1 26.8H16.9L15.3 31H11L20 9ZM20 15.6L18.1 22.9H21.9L20 15.6Z"
        fill="white"
      />
    </svg>
  );
}
