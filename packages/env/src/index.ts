// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/// <reference types="node" />
import { Edition, isBrowser, parseBoolean } from "@carbon/utils";
import { type BrowserEnvName, type EnvName, resolve, schema } from "./schema";
import { formatReport, validateEnv } from "./validate";

export { schema } from "./schema";
export { formatReport, validateEnv } from "./validate";

// VERCEL_URL and VERCEL_ENV are the deprecated names of APP_URL and APP_ENV;
// the root loaders and cached browser bundles still use them.
type BrowserEnv = Record<
  | BrowserEnvName
  | "CARBON_SLACK_ENABLED"
  | "STRIPE_CONNECT_ENABLED"
  | "VERCEL_URL"
  | "VERCEL_ENV",
  string
>;

declare global {
  interface Window {
    env: BrowserEnv;
  }
}

const source: Record<string, string | undefined> =
  (isBrowser ? window.env : process.env) ?? {};

// One report for the whole environment, once per process. The browser never
// validates. Tests supply values by mocking this module or stubbing
// process.env; SKIP_ENV_VALIDATION does the same for a script that must run
// without a full environment.
if (!isBrowser && !source.VITEST && !source.SKIP_ENV_VALIDATION) {
  const report = validateEnv(source);
  if (report.fatal) throw new Error(formatReport(report));
  // biome-ignore lint/suspicious/noConsole: @carbon/logger depends on this package
  if (report.problems.length) console.warn(formatReport(report));
}

export function getEnv(name: EnvName) {
  if (isBrowser && "secret" in schema[name]) return "";
  return resolve(source, name);
}

/**
 * Server env
 */

export type AuthProvider = "email" | "google" | "azure" | "passkey" | "sso";

export const AUTH_PROVIDERS = getEnv("AUTH_PROVIDERS") ?? "email,google,azure";

export function isAuthProviderEnabled(provider: AuthProvider) {
  const AUTH_PROVIDERS_LIST = AUTH_PROVIDERS.split(",").map((p) => p.trim());
  return AUTH_PROVIDERS_LIST.includes(provider);
}
export const BINDERY_PRESS_API_KEY = getEnv("BINDERY_PRESS_API_KEY");

const CARBON_EDITION = getEnv("CARBON_EDITION");

const getEdition = () => {
  if (CARBON_EDITION === "cloud") {
    return Edition.Cloud;
  }
  if (CARBON_EDITION === "enterprise") {
    return Edition.Enterprise;
  }
  if (CARBON_EDITION === "test") {
    return Edition.Test;
  }
  return Edition.Community;
};

export const CarbonEdition = getEdition();

export const CARBON_API_URL =
  getEnv("CARBON_API_URL") ?? getEnv("SUPABASE_URL");

export const DOMAIN = getEnv("DOMAIN"); // preview environments need no domain

export const EXCHANGE_RATES_API_KEY = getEnv("EXCHANGE_RATES_API_KEY");

export const EXTRACTION_CONFIDENCE_THRESHOLD = Number.parseFloat(
  getEnv("EXTRACTION_CONFIDENCE_THRESHOLD") ?? "0.85"
);

export const INNGEST_SIGNING_KEY = getEnv("INNGEST_SIGNING_KEY");
export const INNGEST_EVENT_KEY = getEnv("INNGEST_EVENT_KEY");

export const ERP_URL = getEnv("ERP_URL") ?? "https://app.carbon.ms";
export const MES_URL = getEnv("MES_URL") ?? "https://mes.carbon.ms";

export const ASSEMBLER_SERVICE_URL = getEnv("ASSEMBLER_SERVICE_URL");
// Dev-only (crbn-written): local kong port for the storage-URL rewrite in
// internalizeStorageUrl. Unset in prod.
export const PORT_API = getEnv("PORT_API");
export const ASSEMBLER_SERVICE_API_KEY = getEnv("ASSEMBLER_SERVICE_API_KEY");
// Cap on concurrently running assembler-backed Inngest functions (shared across
// optimize/compact/convert/plan). Must stay within the Inngest plan's account
// concurrency or app sync fails ("function has higher concurrency limits than
// your plan"); raise it via env on plans that allow more.
export const ASSEMBLER_JOB_CONCURRENCY = getEnv("ASSEMBLER_JOB_CONCURRENCY");
// Dev-only: public tunnel origin substituted into assembler-bound storage URLs
// when the assembler is remote (local `.dev` hosts resolve only on this
// machine). Unset in prod/preview.
export const ASSEMBLER_STORAGE_PUBLIC_URL = getEnv(
  "ASSEMBLER_STORAGE_PUBLIC_URL"
);

export const GOOGLE_PLACES_API_KEY = getEnv("GOOGLE_PLACES_API_KEY");

const itarEnvironment = getEnv("CONTROLLED_ENVIRONMENT");

export const CONTROLLED_ENVIRONMENT = parseBoolean(itarEnvironment, false);

// Carbon GovCloud Rider metadata. These are the authoritative `docVersion` /
// `docHash` stamped onto every ITAR certification, and the target of the
// "View the full Rider" link. `ITAR_RIDER_SHA256` is the sha256 of the Rider PDF
// served at `ITAR_RIDER_PDF_PATH` — recompute and update it whenever that PDF
// changes so certifications stamp the exact document that was accepted.
export const ITAR_RIDER_VERSION = "1.0";
export const ITAR_RIDER_SHA256 =
  "e5ec082dfa511561edd86043060b0eff82c019ff95dda2cc7a6d79eff9560874";
export const ITAR_RIDER_PDF_PATH = "https://carbon.ms/itar-rider.pdf";

export const ONSHAPE_CLIENT_ID = getEnv("ONSHAPE_CLIENT_ID");
export const ONSHAPE_CLIENT_SECRET = getEnv("ONSHAPE_CLIENT_SECRET");
export const ONSHAPE_OAUTH_REDIRECT_URL = getEnv("ONSHAPE_OAUTH_REDIRECT_URL");
// Path to the native gltfpack binary (github.com/zeux/meshoptimizer), used to
// compress oversized Onshape GLTF exports into viewer-ready GLBs. Optional:
// when unset (and gltfpack isn't on PATH), oversized models are skipped
// instead of compressed. The npm gltfpack is WASM with a 4GB memory ceiling
// and cannot process large CAD exports — this must point to a native build.
export const GLTFPACK_PATH = getEnv("GLTFPACK_PATH");

export const QUICKBOOKS_CLIENT_ID = getEnv("QUICKBOOKS_CLIENT_ID");

export const QUICKBOOKS_CLIENT_SECRET = getEnv("QUICKBOOKS_CLIENT_SECRET");

/** Intuit environment: "sandbox" or "production" (default). */
export const QUICKBOOKS_ENVIRONMENT =
  getEnv("QUICKBOOKS_ENVIRONMENT") ?? "production";

/**
 * Carbon's own Ramp OAuth application (the "Connect to Ramp" authorization-code
 * flow). Distinct from any single customer's client-credentials pair — this is
 * the one app Carbon registers with Ramp. The client id is public (it appears in
 * the authorize URL); the secret is server-only (code exchange + token refresh).
 */
export const RAMP_CLIENT_ID = getEnv("RAMP_CLIENT_ID");

export const RAMP_CLIENT_SECRET = getEnv("RAMP_CLIENT_SECRET");

export const QUICKBOOKS_WEBHOOK_SECRET = getEnv("QUICKBOOKS_WEBHOOK_SECRET");

export const SMTP_FROM = getEnv("SMTP_FROM");
export const SMTP_HOST = getEnv("SMTP_HOST");
export const SMTP_PASSWORD = getEnv("SMTP_PASSWORD");
export const SMTP_PORT = Number(getEnv("SMTP_PORT") || 587);
export const SMTP_USER = getEnv("SMTP_USER");

export const SLACK_BOT_TOKEN = getEnv("SLACK_BOT_TOKEN");
export const CARBON_SLACK_ENABLED = isBrowser
  ? window.env?.CARBON_SLACK_ENABLED === "true"
  : Boolean(SLACK_BOT_TOKEN);
export const SLACK_CLIENT_ID = getEnv("SLACK_CLIENT_ID");
export const SLACK_CLIENT_SECRET = getEnv("SLACK_CLIENT_SECRET");
export const SLACK_OAUTH_REDIRECT_URL = getEnv("SLACK_OAUTH_REDIRECT_URL");
export const SLACK_SIGNING_SECRET = getEnv("SLACK_SIGNING_SECRET");
export const SLACK_STATE_SECRET = getEnv("SLACK_STATE_SECRET");

export const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");
export const SUPABASE_JWT_SECRET = getEnv("SUPABASE_JWT_SECRET");
export const DATABASE_URL = getEnv("DATABASE_URL");
/** @deprecated Use DATABASE_URL. */
export const SUPABASE_DB_URL = DATABASE_URL;
export const SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID = getEnv(
  "SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID"
);
export const SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID = getEnv(
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID"
);
export const SESSION_SECRET = getEnv("SESSION_SECRET");
export const SESSION_KEY = "auth";
export const SESSION_ERROR_KEY = "error";
export const STRIPE_SECRET_KEY = getEnv("STRIPE_SECRET_KEY");
// Browser-safe boolean signal for whether Stripe (and therefore the Stripe
// Connect integration) is configured. STRIPE_SECRET_KEY is a secret, so it is
// `""` in the browser — the integration's `active` gate must read this derived
// flag instead, which crosses to the client via getBrowserEnv() the same way
// CARBON_SLACK_ENABLED does. Only the boolean is exposed, never the key.
export const STRIPE_CONNECT_ENABLED = isBrowser
  ? window.env?.STRIPE_CONNECT_ENABLED === "true"
  : Boolean(STRIPE_SECRET_KEY);
export const STRIPE_WEBHOOK_SECRET = getEnv("STRIPE_WEBHOOK_SECRET");
// Connect webhook endpoints (`connect: true`) are signed with their OWN secret,
// distinct from the platform-account endpoint above — a Connect event verified
// against STRIPE_WEBHOOK_SECRET fails signature validation.
export const STRIPE_CONNECT_WEBHOOK_SECRET = getEnv(
  "STRIPE_CONNECT_WEBHOOK_SECRET"
);
export const STRIPE_BYPASS_COMPANY_IDS = getEnv("STRIPE_BYPASS_COMPANY_IDS");
export const STRIPE_BYPASS_USER_IDS = getEnv("STRIPE_BYPASS_USER_IDS");
export const GTM_URL = getEnv("GTM_URL");
export const GTM_EVENTS_API_SECRET_KEY = getEnv("GTM_EVENTS_API_SECRET_KEY");
export const REDIS_URL = getEnv("REDIS_URL");
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days;
export const REFRESH_ACCESS_TOKEN_THRESHOLD = 60 * 10; // 10 minutes left before token expires
// Session lock / termination (NIST 800-171 3.1.10 / 3.1.11). All in MILLISECONDS
// (unlike SESSION_MAX_AGE above, which is seconds for the cookie maxAge). Enforced
// only when CONTROLLED_ENVIRONMENT is true. Plain literals, matching SESSION_MAX_AGE
// precedent (not env-overridable in v1).
export const SESSION_IDLE_LOCK_MS = 15 * 60 * 1000; // 15 min — DISA App-Sec STIG web-app idle
export const SESSION_ABSOLUTE_MAX_MS = 12 * 60 * 60 * 1000; // 12 h — absolute session cap
export const SESSION_HEARTBEAT_MS = 60 * 1000; // client activity heartbeat throttle
export const APP_URL = getEnv("APP_URL");
/** @deprecated Use APP_URL. */
export const VERCEL_URL = APP_URL;

export const XERO_CLIENT_ID = getEnv("XERO_CLIENT_ID");
export const XERO_CLIENT_SECRET = getEnv("XERO_CLIENT_SECRET");
export const XERO_WEBHOOK_SECRET = getEnv("XERO_WEBHOOK_SECRET");

export const JIRA_CLIENT_ID = getEnv("JIRA_CLIENT_ID");
export const JIRA_CLIENT_SECRET = getEnv("JIRA_CLIENT_SECRET");
export const JIRA_OAUTH_REDIRECT_URL = getEnv("JIRA_OAUTH_REDIRECT_URL");
export const JIRA_STATE_SECRET = getEnv("JIRA_STATE_SECRET");

/**
 * Shared envs
 */

export const NODE_ENV = getEnv("NODE_ENV");

export const APP_ENV = getEnv("APP_ENV") ?? NODE_ENV;
/** @deprecated Use APP_ENV. */
export const VERCEL_ENV = APP_ENV;

// True only on a developer's local stack — never in prod, preview, or a
// self-hosted deployment (those all run NODE_ENV=production). Gates features
// that stay internal-only in real deployments but should be exercisable by
// anyone locally. Derived from vars already in `getBrowserEnv()`, so it is
// correct client-side too.
export const IS_LOCAL_DEV =
  NODE_ENV !== "production" &&
  VERCEL_ENV !== "production" &&
  VERCEL_ENV !== "preview";

// Turnstile guards login wherever BotID can't run (anything not on Vercel).
// Both keys or neither: a site key alone would render a widget nobody checks.
// A local stack always uses Cloudflare's always-pass test pair, so login works
// with no Turnstile account; the two only pass together.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
export const CLOUDFLARE_TURNSTILE_SITE_KEY = IS_LOCAL_DEV
  ? "1x00000000000000000000AA"
  : getEnv("CLOUDFLARE_TURNSTILE_SITE_KEY");
export const CLOUDFLARE_TURNSTILE_SECRET_KEY = IS_LOCAL_DEV
  ? "1x0000000000000000000000000000000AA"
  : getEnv("CLOUDFLARE_TURNSTILE_SECRET_KEY");

// Set to "1" by Vercel itself on every build and function — never by SST,
// Docker, or a local stack, which all set VERCEL_ENV by hand. Server-only.
export const IS_VERCEL = getEnv("VERCEL") === "1";

// Which check guards login: "botid" or "turnstile". Unset picks one — BotID
// for the Cloud edition on Vercel, else Turnstile when its keys are set. Set it
// when the keys are there for something else (GoTrue, another form) and login
// should still use BotID. Vercel exposes no variable of its own for BotID.
export const BOT_PROTECTION = getEnv("BOT_PROTECTION");

export const POSTHOG_API_HOST = getEnv("POSTHOG_API_HOST");
export const POSTHOG_PROJECT_PUBLIC_KEY = getEnv("POSTHOG_PROJECT_PUBLIC_KEY");
export const SUPABASE_URL = getEnv("SUPABASE_URL");
export const SUPABASE_ANON_KEY = getEnv("SUPABASE_ANON_KEY");

// Server-only. In a BYOC/self-hosted k8s deployment, the server's own calls to
// Supabase can be pointed at an in-cluster address (bypassing the ingress hop
// that some clusters — k3s's load balancer refusing pod-to-own-LB traffic in
// particular — cannot route) while the browser keeps the public SUPABASE_URL.
// Falls back to SUPABASE_URL so every existing deployment (Vercel included) is
// unaffected when unset. Same pattern as INNGEST_BASE_URL: read directly, never
// added to getBrowserEnv() or the Window.env interface, so it cannot leak to
// the browser by construction.
export const SUPABASE_INTERNAL_URL =
  getEnv("SUPABASE_INTERNAL_URL") || SUPABASE_URL;

export const DEFAULT_LANGUAGE = getEnv("DEFAULT_LANGUAGE") ?? "en";

// Level for @carbon/logger. Optional + non-secret so it reaches the browser.
// The logger derives a sensible default when unset (dev: debug, prod: info,
// browser prod: warning), so an invalid/absent value never throws.
export const LOG_LEVEL = getEnv("LOG_LEVEL");

export const RATE_LIMIT = parseInt(getEnv("RATE_LIMIT") || "5", 10);

export function getAppUrl() {
  if (VERCEL_ENV === "production" || NODE_ENV === "production") {
    return ERP_URL
      ? ERP_URL
      : CONTROLLED_ENVIRONMENT
        ? "https://itar.carbon.ms"
        : "https://app.carbon.ms";
  }

  if (VERCEL_ENV === "preview") {
    return `https://${APP_URL}`;
  }

  // Dev: `crbn up` writes ERP_URL=https://<prefix>.erp.dev into .env.local.
  // Honor it so cross-app sidebar links resolve to the portless hostname
  // instead of the hardcoded localhost:3000 fallback.
  return ERP_URL ?? "http://localhost:3000";
}

export function getMESUrl() {
  if (VERCEL_ENV === "production" || NODE_ENV === "production") {
    return MES_URL
      ? MES_URL
      : CONTROLLED_ENVIRONMENT
        ? "https://mes.itar.carbon.ms"
        : "https://mes.carbon.ms";
  }

  if (VERCEL_ENV === "preview") {
    return `https://${APP_URL}`;
  }

  // Dev: `crbn up` writes MES_URL=https://<prefix>.mes.dev into .env.local.
  // Honor it so cross-app sidebar links resolve to the portless hostname
  // instead of the hardcoded localhost:3001 fallback.
  return MES_URL ?? "http://localhost:3001";
}

export function getBrowserEnv() {
  return {
    AUTH_PROVIDERS,
    CARBON_API_URL,
    CARBON_EDITION,
    CARBON_SLACK_ENABLED: CARBON_SLACK_ENABLED ? "true" : "",
    STRIPE_CONNECT_ENABLED: STRIPE_CONNECT_ENABLED ? "true" : "",
    CONTROLLED_ENVIRONMENT,
    DEFAULT_LANGUAGE,
    ERP_URL,
    GOOGLE_PLACES_API_KEY,
    JIRA_CLIENT_ID,
    LOG_LEVEL,
    MES_URL,
    NODE_ENV,
    ONSHAPE_CLIENT_ID,
    POSTHOG_API_HOST,
    POSTHOG_PROJECT_PUBLIC_KEY,
    QUICKBOOKS_CLIENT_ID,
    RAMP_CLIENT_ID,
    SUPABASE_ANON_KEY,
    SUPABASE_URL,
    APP_ENV,
    APP_URL,
    VERCEL_ENV,
    VERCEL_URL,
    XERO_CLIENT_ID
  } satisfies Record<keyof BrowserEnv, unknown>;
}

export function isVercel() {
  return VERCEL_URL?.includes("vercel.app") ?? false;
}
