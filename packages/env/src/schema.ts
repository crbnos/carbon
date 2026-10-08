// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { z } from "zod";

export type Group =
  | "core"
  | "auth"
  | "email"
  | "stripe"
  | "slack"
  | "push"
  | "xero"
  | "quickbooks"
  | "jira"
  | "onshape"
  | "ramp"
  | "ai"
  | "assembler"
  | "observability"
  | "dev";

// A feature is a group that is allowed to be off. It is "half-configured" when
// some of its `needed` variables are set and others are not.
export const FEATURES = {
  email: "Email",
  stripe: "Stripe",
  slack: "Slack",
  push: "Push notifications",
  xero: "Xero",
  quickbooks: "QuickBooks",
  jira: "Jira",
  onshape: "Onshape",
  ramp: "Ramp",
  ai: "AI",
  assembler: "Assembler"
} satisfies Partial<Record<Group, string>>;

type Source = Record<string, string | undefined>;

export type EnvVar = {
  group: Group;
  description: string;
  type?: z.ZodType;
  /** Server-only: reads as "" in the browser. */
  secret?: boolean;
  /** Sent to the browser in `window.env`. */
  browser?: boolean;
  /**
   * "error" stops startup. "warn" is reported and becomes an error in the next
   * release; do not flip one without updating deployments.test.ts.
   */
  required?: "error" | "warn";
  /** Lifts `required` when it returns true. */
  unless?: (env: Source) => boolean;
  /** The feature needs this variable to work at all. */
  needed?: boolean;
  /** Deprecated names still read, in order, after the variable's own. */
  aliases?: readonly string[];
};

const url = z.url();
const number = z.coerce.number();

// getAppUrl / getMESUrl and the email sender only fall back to Carbon's own
// production values in a production build, and Carbon Cloud means them.
const cloudOrDev = (env: Source) =>
  env.CARBON_EDITION === "cloud" || env.NODE_ENV !== "production";

const define = <const T extends Record<string, EnvVar>>(schema: T) => schema;

export const schema = define({
  // ── core ──────────────────────────────────────────────────────────────────
  NODE_ENV: { group: "core", description: "Node mode", browser: true },
  APP_ENV: {
    group: "core",
    description: "Deployment kind; defaults to NODE_ENV",
    type: z.enum(["production", "preview", "development", "test"]),
    browser: true,
    aliases: ["VERCEL_ENV"]
  },
  // Not typed as a URL yet: the VERCEL_URL it falls back to has no scheme on
  // Vercel and in sst.config.ts.
  APP_URL: {
    group: "core",
    description: "This app's own origin, used in sign-in redirects",
    browser: true,
    aliases: ["VERCEL_URL"]
  },
  ERP_URL: {
    group: "core",
    description: "Public URL of the ERP",
    type: url,
    browser: true,
    required: "warn",
    unless: cloudOrDev
  },
  MES_URL: {
    group: "core",
    description: "Public URL of the MES",
    type: url,
    browser: true,
    required: "warn",
    unless: cloudOrDev
  },
  DOMAIN: {
    group: "core",
    description: "Parent domain shared by the apps (cookies, passkeys)"
  },
  CARBON_EDITION: {
    group: "core",
    description: "community (default), cloud, enterprise or test",
    browser: true
  },
  CONTROLLED_ENVIRONMENT: {
    group: "core",
    description: "true for an ITAR / controlled deployment",
    browser: true
  },
  DEFAULT_LANGUAGE: {
    group: "core",
    description: "Default UI language (en)",
    browser: true
  },
  DATABASE_URL: {
    group: "core",
    description: "Postgres connection string",
    type: url,
    secret: true,
    required: "error",
    aliases: ["SUPABASE_DB_URL"]
  },
  SUPABASE_URL: {
    group: "core",
    description: "Public URL of the Supabase API",
    type: url,
    browser: true,
    required: "warn"
  },
  SUPABASE_ANON_KEY: {
    group: "core",
    description: "Supabase anonymous key",
    browser: true,
    required: "warn"
  },
  SUPABASE_SERVICE_ROLE_KEY: {
    group: "core",
    description: "Supabase service-role key",
    secret: true,
    required: "error"
  },
  SUPABASE_JWT_SECRET: {
    group: "core",
    description: "Secret that signs Supabase JWTs",
    secret: true
  },
  SUPABASE_INTERNAL_URL: {
    group: "core",
    description: "In-cluster Supabase URL for server calls",
    type: url
  },
  CARBON_API_URL: {
    group: "core",
    description: "Public URL of the Carbon API; defaults to SUPABASE_URL",
    type: url,
    browser: true
  },
  REDIS_URL: {
    group: "core",
    description: "Redis connection string",
    type: url,
    secret: true,
    required: "error"
  },
  INNGEST_DEV: {
    group: "core",
    description: "Set to use the local Inngest dev server (no keys needed)"
  },
  INNGEST_SIGNING_KEY: {
    group: "core",
    description: "Inngest signing key",
    secret: true,
    required: "error",
    unless: (env) => Boolean(env.INNGEST_DEV)
  },
  INNGEST_EVENT_KEY: {
    group: "core",
    description: "Inngest event key",
    secret: true,
    required: "error",
    unless: (env) => Boolean(env.INNGEST_DEV)
  },
  EXCHANGE_RATES_API_KEY: {
    group: "core",
    description: "Key for the exchange-rates API",
    secret: true
  },
  GOOGLE_PLACES_API_KEY: {
    group: "core",
    description: "Google Places key for address autocomplete",
    browser: true
  },
  BINDERY_PRESS_API_KEY: {
    group: "core",
    description: "Bindery Press API key",
    secret: true
  },
  GLTFPACK_PATH: {
    group: "core",
    description: "Path to a native gltfpack binary"
  },
  VERCEL: {
    group: "core",
    description: "Set to 1 by Vercel itself; never set it by hand",
    secret: true
  },

  // ── auth ──────────────────────────────────────────────────────────────────
  SESSION_SECRET: {
    group: "auth",
    description: "signs the session cookie",
    secret: true,
    required: "error"
  },
  AUTH_PROVIDERS: {
    group: "auth",
    description: "Comma-separated sign-in methods (email,google,azure)",
    browser: true
  },
  RATE_LIMIT: {
    group: "auth",
    description: "Sign-in attempts allowed per window (5)",
    type: number
  },
  BOT_PROTECTION: {
    group: "auth",
    description: "Login bot check: botid or turnstile",
    type: z.enum(["botid", "turnstile"])
  },
  CLOUDFLARE_TURNSTILE_SITE_KEY: {
    group: "auth",
    description: "Turnstile site key"
  },
  CLOUDFLARE_TURNSTILE_SECRET_KEY: {
    group: "auth",
    description: "Turnstile secret key",
    secret: true
  },
  SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID: {
    group: "auth",
    description: "Azure OAuth client id (also read by GoTrue)",
    secret: true
  },
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: {
    group: "auth",
    description: "Google OAuth client id (also read by GoTrue)",
    secret: true
  },

  // ── email ─────────────────────────────────────────────────────────────────
  SMTP_HOST: { group: "email", description: "SMTP server host", needed: true },
  SMTP_PORT: { group: "email", description: "SMTP port (587)", type: number },
  SMTP_USER: { group: "email", description: "SMTP user" },
  SMTP_PASSWORD: { group: "email", description: "SMTP password", secret: true },
  SMTP_FROM: {
    group: "email",
    description: "From address on outgoing email",
    required: "warn",
    unless: (env) => cloudOrDev(env) || Boolean(env.RESEND_DOMAIN)
  },
  RESEND_API_KEY: {
    group: "email",
    description: "Deprecated shorthand for Resend's SMTP; use SMTP_*",
    secret: true
  },
  RESEND_DOMAIN: {
    group: "email",
    description: "Deprecated: sender domain when SMTP_FROM is unset"
  },

  // ── stripe ────────────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: {
    group: "stripe",
    description: "Stripe secret key",
    secret: true,
    needed: true
  },
  STRIPE_WEBHOOK_SECRET: {
    group: "stripe",
    description: "Signing secret of the platform webhook endpoint",
    secret: true,
    needed: true
  },
  STRIPE_CONNECT_WEBHOOK_SECRET: {
    group: "stripe",
    description: "Signing secret of the Connect webhook endpoint",
    secret: true
  },
  STRIPE_BYPASS_COMPANY_IDS: {
    group: "stripe",
    description: "Company ids that skip billing"
  },
  STRIPE_BYPASS_USER_IDS: {
    group: "stripe",
    description: "User ids that skip billing"
  },

  // ── slack ─────────────────────────────────────────────────────────────────
  SLACK_CLIENT_ID: {
    group: "slack",
    description: "Slack app client id",
    needed: true
  },
  SLACK_CLIENT_SECRET: {
    group: "slack",
    description: "Slack app client secret",
    secret: true,
    needed: true
  },
  SLACK_SIGNING_SECRET: {
    group: "slack",
    description: "Slack request signing secret",
    secret: true
  },
  SLACK_STATE_SECRET: {
    group: "slack",
    description: "Secret that signs the Slack OAuth state",
    secret: true
  },
  SLACK_OAUTH_REDIRECT_URL: {
    group: "slack",
    description: "Slack OAuth callback URL",
    type: url
  },
  SLACK_BOT_TOKEN: {
    group: "slack",
    description: "Bot token for Carbon's own Slack workspace",
    secret: true
  },

  // ── push ──────────────────────────────────────────────────────────────────
  VAPID_PUBLIC_KEY: {
    group: "push",
    description:
      "Web Push public key (pnpm dlx web-push generate-vapid-keys). Generate once: a new pair makes every user turn push on again",
    needed: true
  },
  VAPID_PRIVATE_KEY: {
    group: "push",
    description: "Web Push private key, paired with VAPID_PUBLIC_KEY",
    secret: true,
    needed: true
  },
  VAPID_SUBJECT: {
    group: "push",
    description: "Contact for push services: a mailto: or https: URL",
    needed: true
  },

  // ── xero ──────────────────────────────────────────────────────────────────
  XERO_CLIENT_ID: {
    group: "xero",
    description: "Xero app client id",
    browser: true,
    needed: true
  },
  XERO_CLIENT_SECRET: {
    group: "xero",
    description: "Xero app client secret",
    secret: true,
    needed: true
  },
  XERO_WEBHOOK_SECRET: {
    group: "xero",
    description: "Xero webhook signing key",
    secret: true
  },

  // ── quickbooks ────────────────────────────────────────────────────────────
  QUICKBOOKS_CLIENT_ID: {
    group: "quickbooks",
    description: "Intuit app client id",
    browser: true,
    needed: true
  },
  QUICKBOOKS_CLIENT_SECRET: {
    group: "quickbooks",
    description: "Intuit app client secret",
    secret: true,
    needed: true
  },
  QUICKBOOKS_ENVIRONMENT: {
    group: "quickbooks",
    description: "sandbox or production (default)",
    type: z.enum(["sandbox", "production"])
  },
  QUICKBOOKS_WEBHOOK_SECRET: {
    group: "quickbooks",
    description: "Unused; the webhook reads QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN",
    secret: true
  },

  // ── jira ──────────────────────────────────────────────────────────────────
  JIRA_CLIENT_ID: {
    group: "jira",
    description: "Atlassian app client id",
    browser: true,
    needed: true
  },
  JIRA_CLIENT_SECRET: {
    group: "jira",
    description: "Atlassian app client secret",
    secret: true,
    needed: true
  },
  JIRA_OAUTH_REDIRECT_URL: { group: "jira", description: "Unused", type: url },
  JIRA_STATE_SECRET: { group: "jira", description: "Unused", secret: true },

  // ── onshape ───────────────────────────────────────────────────────────────
  ONSHAPE_CLIENT_ID: {
    group: "onshape",
    description: "Onshape app client id",
    browser: true,
    needed: true
  },
  ONSHAPE_CLIENT_SECRET: {
    group: "onshape",
    description: "Onshape app client secret",
    secret: true,
    needed: true
  },
  ONSHAPE_OAUTH_REDIRECT_URL: {
    group: "onshape",
    description: "Onshape OAuth callback URL",
    type: url
  },

  // ── ramp ──────────────────────────────────────────────────────────────────
  RAMP_CLIENT_ID: {
    group: "ramp",
    description: "Carbon's Ramp OAuth app client id",
    browser: true,
    needed: true
  },
  RAMP_CLIENT_SECRET: {
    group: "ramp",
    description: "Carbon's Ramp OAuth app client secret",
    secret: true,
    needed: true
  },

  // ── ai ────────────────────────────────────────────────────────────────────
  AI_API_KEY: {
    group: "ai",
    description: "API key for the OpenAI-compatible model provider",
    secret: true,
    aliases: ["OPENAI_API_KEY"]
  },
  AI_BASE_URL: {
    group: "ai",
    description: "Base URL of the model provider",
    type: url
  },
  AI_MODEL: { group: "ai", description: "Model used to extract documents" },
  EXTRACTION_CONFIDENCE_THRESHOLD: {
    group: "ai",
    description: "Minimum confidence to accept an extracted field (0.85)",
    type: number
  },

  // ── assembler ─────────────────────────────────────────────────────────────
  ASSEMBLER_SERVICE_URL: {
    group: "assembler",
    description: "URL of the CAD assembler service",
    type: url,
    needed: true
  },
  ASSEMBLER_SERVICE_API_KEY: {
    group: "assembler",
    description: "API key for the assembler service",
    secret: true,
    needed: true
  },
  ASSEMBLER_JOB_CONCURRENCY: {
    group: "assembler",
    description: "Cap on concurrent assembler jobs",
    type: number
  },
  ASSEMBLER_STORAGE_PUBLIC_URL: {
    group: "assembler",
    description: "Dev only: public tunnel origin for storage URLs",
    type: url
  },

  // ── observability ─────────────────────────────────────────────────────────
  LOG_LEVEL: {
    group: "observability",
    description: "Log level",
    browser: true
  },
  POSTHOG_API_HOST: {
    group: "observability",
    description: "PostHog host",
    browser: true
  },
  POSTHOG_PROJECT_PUBLIC_KEY: {
    group: "observability",
    description: "PostHog project key",
    browser: true
  },
  GTM_URL: { group: "observability", description: "Go-to-market events URL" },
  GTM_EVENTS_API_SECRET_KEY: {
    group: "observability",
    description: "Go-to-market events API key",
    secret: true
  },

  // ── dev ───────────────────────────────────────────────────────────────────
  PORT_API: {
    group: "dev",
    description: "Written by crbn: local API gateway port"
  }
});

export type EnvName = keyof typeof schema;

export type BrowserEnvName = {
  [K in EnvName]: (typeof schema)[K] extends { browser: true } ? K : never;
}[EnvName];

/** The variable's own value, else the first deprecated alias that is set. */
export function resolve(source: Source, name: EnvName) {
  const { aliases = [] } = schema[name] as EnvVar;
  for (const key of [name, ...aliases]) {
    if (source[key]) return source[key];
  }
  return source[name];
}
