import type { ComponentProps } from "react";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { StripeConnectSetupInstructions } from "./setup-instructions";

export const StripeConnectSettingsSchema = z.object({
  stripeAccountId: z.string().optional(),
  chargesEnabled: z.boolean().optional().default(false),
  payoutsEnabled: z.boolean().optional().default(false),
  autoEnableInvoicing: z.boolean().optional().default(true)
});

export const StripeConnect = defineIntegration({
  name: "Stripe Connect",
  id: "stripe-connect",
  active: true,
  category: "Payments",
  logo: StripeLogo,
  description:
    "Connect your Stripe account to send invoices with direct online payment options to your customers, automatically updating payment statuses and AR ledger entries.",
  shortDescription: "Accept card and ACH payments directly on sales invoices.",
  setupInstructions: StripeConnectSetupInstructions,
  images: [],
  schema: StripeConnectSettingsSchema,
  settingGroups: [
    {
      name: "Invoicing Settings",
      description: "Configure payment options for sales invoices"
    }
  ],
  settings: [
    {
      name: "autoEnableInvoicing",
      label: "Default to Online Payments",
      description:
        "Automatically include Stripe online payment links on newly created sales invoices",
      group: "Invoicing Settings",
      type: "switch" as const,
      required: false,
      value: true
    }
  ],
  actions: [
    {
      id: "connect",
      label: "Connect Stripe Account",
      description:
        "Start Stripe Connect onboarding to enable payment processing",
      endpoint: "/api/integrations/stripe-connect/connect"
    },
    {
      id: "dashboard",
      label: "Open Express Dashboard",
      description: "View payouts, transactions, and account details in Stripe",
      endpoint: "/api/integrations/stripe-connect/dashboard"
    }
  ]
});

function StripeLogo(props: ComponentProps<"svg">) {
  return (
    <svg
      {...props}
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="40" height="40" rx="8" fill="#635BFF" />
      <path
        d="M18.8 15.3C18.8 14.5 19.5 14.1 20.7 14.1C22.3 14.1 24.3 14.6 25.8 15.4V11.2C24.1 10.5 22.4 10.2 20.6 10.2C16 10.2 13 12.6 13 16.3C13 22.4 21.3 21.4 21.3 24.2C21.3 25.2 20.3 25.6 19 25.6C17.2 25.6 14.9 24.8 13.2 23.9V28.3C15.1 29.2 17.2 29.7 19.2 29.7C24 29.7 27.1 27.4 27.1 23.4C27.1 16.9 18.8 18 18.8 15.3Z"
        fill="white"
      />
    </svg>
  );
}
