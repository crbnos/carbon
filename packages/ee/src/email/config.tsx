import { HiEnvelope } from "react-icons/hi2";
import { z } from "zod";
import { defineIntegration } from "../fns";

export const Email = defineIntegration({
  name: "Email",
  id: "email",
  active: true,
  category: "Email",
  logo: HiEnvelope,
  description:
    "Send transactional emails — quotes, purchase orders, invoices, and more — from your own domain. Pick Resend for a managed email API, or Custom SMTP to use your own mail server.",
  shortDescription:
    "Deliver transactional emails via Resend or a custom SMTP server.",
  images: [],

  settingGroups: [
    {
      name: "Resend",
      description: "API credentials for your Resend account."
    },
    {
      name: "SMTP",
      description: "Credentials for your custom SMTP server."
    }
  ],
  settings: [
    {
      name: "provider",
      label: "Delivery method",
      description: "How transactional emails are delivered for this company.",
      type: "cards",

      required: true,
      value: "resend",
      listOptions: [
        {
          value: "resend",
          label: "Resend",
          description: "Managed email API with domain verification."
        },
        {
          value: "smtp",
          label: "Custom SMTP",
          description: "Bring your own SMTP server."
        }
      ]
    },
    {
      name: "fromEmail",
      label: "From email",
      description:
        "The sender address your customers will see. Must be a domain you control.",
      type: "text",
      required: true,
      value: ""
    },
    // Resend group
    {
      name: "apiKey",
      label: "API key",
      description: "Create one in the Resend dashboard under API Keys.",
      type: "secret",
      required: true,
      value: "",
      group: "Resend",
      visibleWhen: { field: "provider", equals: "resend" }
    },
    // SMTP group
    {
      name: "host",
      label: "Host",
      type: "text",
      required: true,
      value: "",
      group: "SMTP",
      visibleWhen: { field: "provider", equals: "smtp" }
    },
    {
      name: "port",
      label: "Port",
      type: "number",
      required: true,
      value: 587,
      group: "SMTP",
      visibleWhen: { field: "provider", equals: "smtp" }
    },
    {
      name: "username",
      label: "Username",
      type: "text",
      required: true,
      value: "",
      group: "SMTP",
      visibleWhen: { field: "provider", equals: "smtp" }
    },
    {
      name: "password",
      label: "Password",
      type: "secret",
      required: true,
      value: "",
      group: "SMTP",
      visibleWhen: { field: "provider", equals: "smtp" }
    },
    {
      name: "secure",
      label: "Use TLS",
      description:
        "For implicit TLS (SMTPS) — ports 465 or 2465. Leave off for STARTTLS — ports 25, 587, 2525, or 2587.",
      type: "switch",
      required: false,
      value: false,
      group: "SMTP",
      visibleWhen: { field: "provider", equals: "smtp" }
    }
  ],
  schema: z.discriminatedUnion("provider", [
    z.object({
      provider: z.literal("resend"),
      fromEmail: z.string().email(),
      // Empty means "keep the existing vaulted secret"; presence enforced at install.
      apiKey: z.string()
    }),
    z.object({
      provider: z.literal("smtp"),
      fromEmail: z.string().email(),
      host: z.string().min(1, { message: "Host is required" }),
      port: z.coerce
        .number()
        .int()
        .min(1, { message: "Port must be between 1 and 65535" })
        .max(65535, { message: "Port must be between 1 and 65535" }),
      username: z.string().min(1, { message: "Username is required" }),
      // Empty means "keep the existing vaulted secret"; presence enforced at install.
      password: z.string(),
      // `SwitchField` in the integration form always posts a literal
      // "true"/"false" string, and `z.coerce.boolean()` would treat both as
      // truthy (non-empty strings). Preprocess explicitly so unchecking the
      // switch actually sticks.
      secure: z
        .preprocess((v) => {
          if (typeof v === "boolean") return v;
          if (v === "true") return true;
          if (v === "false") return false;
          return v;
        }, z.boolean())
        .default(false)
    })
  ])
});
