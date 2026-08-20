/// <reference types="node" />
import { Edition, isBrowser, parseBoolean } from "@carbon/utils";

declare global {
  interface Window {
    env: {
      AUTH_PROVIDERS: string;
      CARBON_EDITION: string;
      CARBON_API_URL: string;
      CARBON_SLACK_ENABLED: string;
      CLOUDFLARE_TURNSTILE_SITE_KEY: string;
      CONTROLLED_ENVIRONMENT: string;
      ERP_URL: string;
      JIRA_CLIENT_ID: string;
      LOG_LEVEL: string;
      MES_URL: string;
      NODE_ENV: string;
      ONSHAPE_CLIENT_ID: string;
      POSTHOG_API_HOST: string;
      POSTHOG_PROJECT_PUBLIC_KEY: string;
      SUPABASE_URL: string;
      SUPABASE_ANON_KEY: string;
      VERCEL_URL: string;
      VERCEL_ENV: string;
      QUICKBOOKS_CLIENT_ID: string;
      XERO_CLIENT_ID: string;
      DEFAULT_LANGUAGE: string;
    };
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CARBON_EDITION: string;
      CARBON_API_URL: string;
      CLOUDFLARE_TURNSTILE_SITE_KEY: string;
      CLOUDFLARE_TURNSTILE_SECRET_KEY: string;
      DOMAIN: string;
      ERP_URL: string;
      JIRA_CLIENT_ID: string;
      JIRA_CLIENT_SECRET: string;
      JIRA_OAUTH_REDIRECT_URL: string;
      JIRA_STATE_SECRET: string;
      LOG_LEVEL: string;
      MES_URL: string;
      ONSHAPE_CLIENT_ID: string;
      ONSHAPE_CLIENT_SECRET: string;
      ONSHAPE_OAUTH_REDIRECT_URL: string;
      POSTHOG_API_HOST: string;
      POSTHOG_PROJECT_PUBLIC_KEY: string;
      QUICKBOOKS_CLIENT_SECRET: string;
      QUICKBOOKS_ENVIRONMENT: string;
      QUICKBOOKS_WEBHOOK_SECRET: string;
      RESEND_API_KEY: string;
      RESEND_DOMAIN: string;
      SESSION_SECRET: string;
      SESSION_KEY: string;
      SESSION_ERROR_KEY: string;
      SLACK_CLIENT_ID: string;
      SLACK_CLIENT_SECRET: string;
      SLACK_OAUTH_REDIRECT_URL: string;
      SLACK_SIGNING_SECRET: string;
      SLACK_STATE_SECRET: string;
      STRIPE_SECRET_KEY: string;
      STRIPE_WEBHOOK_SECRET: string;
      STRIPE_BYPASS_COMPANY_IDS: string;
      STRIPE_BYPASS_USER_IDS: string;
      GTM_URL: string;
      GTM_EVENTS_API_SECRET_KEY: string;
      SUPABASE_ANON_KEY: string;
      SUPABASE_URL: string;
      SUPABASE_DB_URL: string;
      SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID: string;
      SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: string;
      SUPABASE_SERVICE_ROLE_KEY: string;
      REDIS_URL: string;
      VERCEL_URL: string;
      VERCEL_ENV: string;
      INNGEST_SIGNING_KEY: string;
      INNGEST_EVENT_KEY: string;
      XERO_CLIENT_SECRET: string;
      XERO_WEBHOOK_SECRET: string;
      DEFAULT_LANGUAGE: string;
      EXTRACTION_CONFIDENCE_THRESHOLD: string;
    }
  }
}

type EnvOptions = {
  isSecret?: boolean;
  isRequired?: boolean;
};

export function getEnv(
  name: string,
  { isRequired, isSecret }: EnvOptions = { isRequired: true, isSecret: true }
) {
  if (isBrowser && isSecret) return "";

  const source = (isBrowser ? window.env : process.env) ?? {};

  const value = source[name as keyof typeof source];

  if (!value && isRequired) {
    throw new Error(`${name} is not set`);
  }

  return value;
}

/**
 * Server env
 */

export type AuthProvider = "email" | "google" | "azure" | "passkey";

export const AUTH_PROVIDERS =
  getEnv("AUTH_PROVIDERS", {
    isRequired: false,
    isSecret: false
  }) ?? "email,google,azure";

export function isAuthProviderEnabled(provider: AuthProvider) {
  const AUTH_PROVIDERS_LIST = AUTH_PROVIDERS.split(",").map((p) => p.trim());
  return AUTH_PROVIDERS_LIST.includes(provider);
}
export const BINDERY_PRESS_API_KEY = getEnv("BINDERY_PRESS_API_KEY", {
  isRequired: false,
  isSecret: true
});

const CARBON_EDITION = getEnv("CARBON_EDITION", {
  isRequired: false,
  isSecret: false
});

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
  getEnv("CARBON_API_URL", {
    isRequired: false,
    isSecret: false
  }) ?? getEnv("SUPABASE_URL", { isSecret: false });

export const CLOUDFLARE_TURNSTILE_SITE_KEY = getEnv(
  "CLOUDFLARE_TURNSTILE_SITE_KEY",
  { isRequired: false, isSecret: false }
);
export const CLOUDFLARE_TURNSTILE_SECRET_KEY = getEnv(
  "CLOUDFLARE_TURNSTILE_SECRET_KEY",
  { isRequired: false }
);

export const DOMAIN = getEnv("DOMAIN", { isRequired: false }); // preview environments need no domain

export const EXCHANGE_RATES_API_KEY = getEnv("EXCHANGE_RATES_API_KEY", {
  isRequired: false,
  isSecret: true
});

export const EXTRACTION_CONFIDENCE_THRESHOLD = Number.parseFloat(
  getEnv("EXTRACTION_CONFIDENCE_THRESHOLD", {
    isRequired: false,
    isSecret: false
  }) ?? "0.85"
);

const INNGEST_DEV = getEnv("INNGEST_DEV", { isRequired: false });

export const INNGEST_SIGNING_KEY = getEnv("INNGEST_SIGNING_KEY", {
  isRequired: !INNGEST_DEV,
  isSecret: true
});
export const INNGEST_EVENT_KEY = getEnv("INNGEST_EVENT_KEY", {
  isRequired: !INNGEST_DEV,
  isSecret: true
});

export const ERP_URL =
  getEnv("ERP_URL", { isRequired: false, isSecret: false }) ??
  "https://app.carbon.ms";
export const MES_URL =
  getEnv("MES_URL", { isRequired: false, isSecret: false }) ??
  "https://mes.carbon.ms";

export const ASSEMBLER_SERVICE_URL = getEnv("ASSEMBLER_SERVICE_URL", {
  isRequired: false
});
// Dev-only (crbn-written): local kong port for the storage-URL rewrite in
// internalizeStorageUrl. Unset in prod.
export const PORT_API = getEnv("PORT_API", {
  isRequired: false,
  isSecret: false
});
export const ASSEMBLER_SERVICE_API_KEY = getEnv("ASSEMBLER_SERVICE_API_KEY", {
  isRequired: false,
  isSecret: true
});
// Cap on concurrently running assembler-backed Inngest functions (shared across
// optimize/compact/convert/plan). Must stay within the Inngest plan's account
// concurrency or app sync fails ("function has higher concurrency limits than
// your plan"); raise it via env on plans that allow more.
export const ASSEMBLER_JOB_CONCURRENCY = getEnv("ASSEMBLER_JOB_CONCURRENCY", {
  isRequired: false,
  isSecret: false
});
// Dev-only: public tunnel origin substituted into assembler-bound storage URLs
// when the assembler is remote (local `.dev` hosts resolve only on this
// machine). Unset in prod/preview.
export const ASSEMBLER_STORAGE_PUBLIC_URL = getEnv(
  "ASSEMBLER_STORAGE_PUBLIC_URL",
  { isRequired: false, isSecret: false }
);

export const GOOGLE_PLACES_API_KEY = getEnv("GOOGLE_PLACES_API_KEY", {
  isRequired: false
});

const itarEnvironment = getEnv("CONTROLLED_ENVIRONMENT", {
  isRequired: false,
  isSecret: false
});

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

export const ONSHAPE_CLIENT_ID = getEnv("ONSHAPE_CLIENT_ID", {
  isRequired: false
});
export const ONSHAPE_CLIENT_SECRET = getEnv("ONSHAPE_CLIENT_SECRET", {
  isRequired: false,
  isSecret: true
});
export const ONSHAPE_OAUTH_REDIRECT_URL = getEnv("ONSHAPE_OAUTH_REDIRECT_URL", {
  isRequired: false
});
// Path to the native gltfpack binary (github.com/zeux/meshoptimizer), used to
// compress oversized Onshape GLTF exports into viewer-ready GLBs. Optional:
// when unset (and gltfpack isn't on PATH), oversized models are skipped
// instead of compressed. The npm gltfpack is WASM with a 4GB memory ceiling
// and cannot process large CAD exports — this must point to a native build.
export const GLTFPACK_PATH = getEnv("GLTFPACK_PATH", {
  isRequired: false,
  isSecret: false
});

export const QUICKBOOKS_CLIENT_ID = getEnv("QUICKBOOKS_CLIENT_ID", {
  isRequired: false
});

export const QUICKBOOKS_CLIENT_SECRET = getEnv("QUICKBOOKS_CLIENT_SECRET", {
  isRequired: false,
  isSecret: true
});

/** Intuit environment: "sandbox" or "production" (default). */
export const QUICKBOOKS_ENVIRONMENT =
  getEnv("QUICKBOOKS_ENVIRONMENT", {
    isRequired: false,
    isSecret: false
  }) ?? "production";

export const QUICKBOOKS_WEBHOOK_SECRET = getEnv("QUICKBOOKS_WEBHOOK_SECRET", {
  isRequired: false,
  isSecret: true
});

export const RESEND_DOMAIN =
  getEnv("RESEND_DOMAIN", {
    isRequired: false
  }) ?? "carbon.ms";

export const SLACK_BOT_TOKEN = getEnv("SLACK_BOT_TOKEN", {
  isRequired: false
});
export const CARBON_SLACK_ENABLED = isBrowser
  ? window.env?.CARBON_SLACK_ENABLED === "true"
  : Boolean(SLACK_BOT_TOKEN);
export const SLACK_CLIENT_ID = getEnv("SLACK_CLIENT_ID", {
  isRequired: false
});
export const SLACK_CLIENT_SECRET = getEnv("SLACK_CLIENT_SECRET", {
  isRequired: false,
  isSecret: true
});
export const SLACK_OAUTH_REDIRECT_URL = getEnv("SLACK_OAUTH_REDIRECT_URL", {
  isRequired: false
});
export const SLACK_SIGNING_SECRET = getEnv("SLACK_SIGNING_SECRET", {
  isRequired: false,
  isSecret: true
});
export const SLACK_STATE_SECRET = getEnv("SLACK_STATE_SECRET", {
  isRequired: false,
  isSecret: true
});

export const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");
export const SUPABASE_JWT_SECRET = getEnv("SUPABASE_JWT_SECRET", {
  isSecret: true,
  isRequired: false
});
export const SUPABASE_DB_URL = getEnv("SUPABASE_DB_URL", {
  isRequired: true,
  isSecret: true
});
export const SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID = getEnv(
  "SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID",
  {
    isRequired: false,
    isSecret: true
  }
);
export const SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID = getEnv(
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID",
  {
    isRequired: false,
    isSecret: true
  }
);

export const SESSION_SECRET = getEnv("SESSION_SECRET");
export const SESSION_KEY = "auth";
export const SESSION_ERROR_KEY = "error";
export const STRIPE_SECRET_KEY = getEnv("STRIPE_SECRET_KEY", {
  isRequired: false
});
export const STRIPE_WEBHOOK_SECRET = getEnv("STRIPE_WEBHOOK_SECRET", {
  isRequired: false
});
export const STRIPE_BYPASS_COMPANY_IDS = getEnv("STRIPE_BYPASS_COMPANY_IDS", {
  isRequired: false
});
export const STRIPE_BYPASS_USER_IDS = getEnv("STRIPE_BYPASS_USER_IDS", {
  isRequired: false
});
export const GTM_URL = getEnv("GTM_URL", {
  isRequired: false,
  isSecret: false
});
export const GTM_EVENTS_API_SECRET_KEY = getEnv("GTM_EVENTS_API_SECRET_KEY", {
  isRequired: false,
  isSecret: true
});
export const REDIS_URL = getEnv("REDIS_URL", {
  isRequired: true,
  isSecret: true
});
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days;
export const REFRESH_ACCESS_TOKEN_THRESHOLD = 60 * 10; // 10 minutes left before token expires
// Session lock / termination (NIST 800-171 3.1.10 / 3.1.11). All in MILLISECONDS
// (unlike SESSION_MAX_AGE above, which is seconds for the cookie maxAge). Enforced
// only when CONTROLLED_ENVIRONMENT is true. Plain literals, matching SESSION_MAX_AGE
// precedent (not env-overridable in v1).
export const SESSION_IDLE_LOCK_MS = 15 * 60 * 1000; // 15 min — DISA App-Sec STIG web-app idle
export const SESSION_ABSOLUTE_MAX_MS = 12 * 60 * 60 * 1000; // 12 h — absolute session cap
export const SESSION_HEARTBEAT_MS = 60 * 1000; // client activity heartbeat throttle
export const VERCEL_URL = getEnv("VERCEL_URL", { isSecret: false });

export const XERO_CLIENT_ID = getEnv("XERO_CLIENT_ID", {
  isRequired: false
});
export const XERO_CLIENT_SECRET = getEnv("XERO_CLIENT_SECRET", {
  isRequired: false,
  isSecret: true
});
export const XERO_WEBHOOK_SECRET = getEnv("XERO_WEBHOOK_SECRET", {
  isRequired: false,
  isSecret: true
});

export const JIRA_CLIENT_ID = getEnv("JIRA_CLIENT_ID", {
  isRequired: false
});
export const JIRA_CLIENT_SECRET = getEnv("JIRA_CLIENT_SECRET", {
  isRequired: false,
  isSecret: true
});
export const JIRA_OAUTH_REDIRECT_URL = getEnv("JIRA_OAUTH_REDIRECT_URL", {
  isRequired: false
});
export const JIRA_STATE_SECRET = getEnv("JIRA_STATE_SECRET", {
  isRequired: false,
  isSecret: true
});

/**
 * Shared envs
 */

export const NODE_ENV = getEnv("NODE_ENV", {
  isRequired: false,
  isSecret: false
});

export const VERCEL_ENV =
  getEnv("VERCEL_ENV", {
    isRequired: false,
    isSecret: false
  }) ?? NODE_ENV;

// True only on a developer's local stack — never in prod, preview, or a
// self-hosted deployment (those all run NODE_ENV=production). Gates features
// that stay internal-only in real deployments but should be exercisable by
// anyone locally. Derived from vars already in `getBrowserEnv()`, so it is
// correct client-side too.
export const IS_LOCAL_DEV =
  NODE_ENV !== "production" &&
  VERCEL_ENV !== "production" &&
  VERCEL_ENV !== "preview";

export const POSTHOG_API_HOST = getEnv("POSTHOG_API_HOST", {
  isSecret: false
});
export const POSTHOG_PROJECT_PUBLIC_KEY = getEnv("POSTHOG_PROJECT_PUBLIC_KEY", {
  isSecret: false
});
export const SUPABASE_URL = getEnv("SUPABASE_URL", { isSecret: false });
export const SUPABASE_ANON_KEY = getEnv("SUPABASE_ANON_KEY", {
  isSecret: false
});

export const DEFAULT_LANGUAGE =
  getEnv("DEFAULT_LANGUAGE", {
    isRequired: false,
    isSecret: false
  }) ?? "en";

// Level for @carbon/logger. Optional + non-secret so it reaches the browser.
// The logger derives a sensible default when unset (dev: debug, prod: info,
// browser prod: warning), so an invalid/absent value never throws.
export const LOG_LEVEL = getEnv("LOG_LEVEL", {
  isRequired: false,
  isSecret: false
});

export const RATE_LIMIT = parseInt(
  getEnv("RATE_LIMIT", { isRequired: false, isSecret: false }) || "5",
  10
);

export function getAppUrl() {
  if (VERCEL_ENV === "production" || NODE_ENV === "production") {
    return ERP_URL
      ? ERP_URL
      : CONTROLLED_ENVIRONMENT
        ? "https://itar.carbon.ms"
        : "https://app.carbon.ms";
  }

  if (VERCEL_ENV === "preview") {
    return `https://${process.env.VERCEL_URL}`;
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
    return `https://${process.env.VERCEL_URL}`;
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
    CLOUDFLARE_TURNSTILE_SITE_KEY,
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
    SUPABASE_ANON_KEY,
    SUPABASE_URL,
    VERCEL_ENV,
    VERCEL_URL,
    XERO_CLIENT_ID
  };
}

export function isVercel() {
  return VERCEL_URL?.includes("vercel.app") ?? false;
}
