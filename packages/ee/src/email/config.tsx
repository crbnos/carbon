// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { ComponentProps } from "react";
import { HiEnvelope } from "react-icons/hi2";
import { z } from "zod";
import { defineIntegration } from "../fns";

// Carbon's own integration has no vendor mark, so the envelope wears a plain
// mail-blue to sit beside the branded, colored logos instead of reading as an
// unfinished monochrome placeholder.
function Logo(props: ComponentProps<"svg">) {
  return <HiEnvelope {...props} style={{ color: "#3B82F6" }} />;
}

export const Email = defineIntegration({
  name: "Email",
  id: "email",
  active: true,
  category: "Email",
  logo: Logo,
  description:
    "Send transactional emails — quotes, purchase orders, invoices, and more. Use this server's mail settings, or pick Resend, Custom SMTP or Gmail to send from your own account.",
  shortDescription:
    "Deliver transactional emails via this server's mail settings, Resend, a custom SMTP server, or Gmail.",
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
          value: "server",
          label: "Server mail",
          description:
            "The default. Documents are sent from this server's address under your company's name, so no credentials are needed."
        },
        {
          value: "resend",
          label: "Resend",
          description: "Managed email API with domain verification."
        },
        {
          value: "smtp",
          label: "Custom SMTP",
          description: "Bring your own SMTP server."
        },
        {
          value: "gmail",
          label: "Gmail",
          description:
            "Send as a Google account you connected on the Gmail integration."
        }
      ]
    },
    {
      name: "fromEmail",
      label: "From email",
      description:
        "The sender address your customers will see. Must be a domain you control. With Server mail, documents are sent from this server's address under your company's name, and replies go to the address you enter here.",
      type: "text",
      // Required for Resend and Custom SMTP; the schema enforces that.
      required: false,
      value: "",
      // Gmail always sends as the connected account.
      visibleWhen: { field: "provider", equals: ["server", "resend", "smtp"] }
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
    },
    {
      name: "gmailConnectionId",
      label: "Gmail account",
      description:
        "The connected Google account that sends your email. Connect one on the Gmail integration first.",
      type: "options",
      required: true,
      value: "",
      // Filled per company by the settings loader.
      listOptions: [],
      visibleWhen: { field: "provider", equals: "gmail" }
    }
  ],
  schema: z.discriminatedUnion("provider", [
    z.object({
      provider: z.literal("server"),
      // Empty means "use this server's sender address".
      fromEmail: z.union([z.string().email(), z.literal("")]).default("")
    }),
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
    }),
    z.object({
      provider: z.literal("gmail"),
      gmailConnectionId: z.string().min(1, { message: "Pick a Gmail account" })
    })
  ])
});
