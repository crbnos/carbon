import { Edition, isBrowser, parseBoolean } from "@carbon/utils";

declare global {
  interface Window {
    env: {
      CARBON_EDITION: string;
      CLOUDFLARE_TURNSTILE_SITE_KEY: string;
      CONTROLLED_ENVIRONMENT: string;
      POSTHOG_API_HOST: string;
      POSTHOG_PROJECT_PUBLIC_KEY: string;
      SUPABASE_URL: string;
      SUPABASE_ANON_KEY: string;
      VERCEL_URL: string;
      VERCEL_ENV: string;
    };
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CARBON_EDITION: string;
      DOMAIN: string;
      NOVU_SECRET_KEY: string;
      POSTHOG_API_HOST: string;
      POSTHOG_PROJECT_PUBLIC_KEY: string;
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
      SUPABASE_ANON_KEY: string;
      SUPABASE_URL: string;
      SUPABASE_SERVICE_ROLE_KEY: string;
      UPSTASH_REDIS_REST_URL: string;
      UPSTASH_REDIS_REST_TOKEN: string;
      VERCEL_URL: string;
      VERCEL_ENV: string;
      CLOUDFLARE_TURNSTILE_SITE_KEY: string;
      CLOUDFLARE_TURNSTILE_SECRET_KEY: string;
    }
  }
}

type EnvOptions = {
  isSecret?: boolean;
  isRequired?: boolean;
};

export function getEnv(
  name: string,
  { isRequired, isSecret }: EnvOptions = { isSecret: true, isRequired: true }
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

const CARBON_EDITION = getEnv("CARBON_EDITION", {
  isRequired: false,
  isSecret: false,
});

const getEdition = () => {
  if (CARBON_EDITION === "cloud") {
    return Edition.Cloud;
  }
  if (CARBON_EDITION === "enterprise") {
    return Edition.Enterprise;
  }
  return Edition.Community;
};

export const CarbonEdition = getEdition();

export const DOMAIN = getEnv("DOMAIN", { isRequired: false }); // preview environments need no domain
export const EXCHANGE_RATES_API_KEY = getEnv("EXCHANGE_RATES_API_KEY", {
  isRequired: false,
  isSecret: true,
});

const itarEnvironment = getEnv("CONTROLLED_ENVIRONMENT", {
  isRequired: false,
  isSecret: false,
});

export const CONTROLLED_ENVIRONMENT = parseBoolean(itarEnvironment, false);

export const NOVU_APPLICATION_ID = getEnv("NOVU_APPLICATION_ID", {
  isRequired: false,
  isSecret: false,
});
export const NOVU_SECRET_KEY = getEnv("NOVU_SECRET_KEY");
export const RESEND_DOMAIN =
  getEnv("RESEND_DOMAIN", {
    isRequired: false,
  }) ?? "carbon.ms";

export const SLACK_BOT_TOKEN = getEnv("SLACK_BOT_TOKEN", {
  isRequired: false,
});
export const SLACK_CLIENT_ID = getEnv("SLACK_CLIENT_ID", {
  isRequired: false,
});
export const SLACK_CLIENT_SECRET = getEnv("SLACK_CLIENT_SECRET", {
  isRequired: false,
  isSecret: true,
});
export const SLACK_OAUTH_REDIRECT_URL = getEnv("SLACK_OAUTH_REDIRECT_URL", {
  isRequired: false,
});
export const SLACK_SIGNING_SECRET = getEnv("SLACK_SIGNING_SECRET", {
  isRequired: false,
  isSecret: true,
});
export const SLACK_STATE_SECRET = getEnv("SLACK_STATE_SECRET", {
  isRequired: false,
  isSecret: true,
});

export const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");
export const SESSION_SECRET = getEnv("SESSION_SECRET");
export const SESSION_KEY = "auth";
export const SESSION_ERROR_KEY = "error";
export const STRIPE_SECRET_KEY = getEnv("STRIPE_SECRET_KEY", {
  isRequired: false,
});
export const STRIPE_WEBHOOK_SECRET = getEnv("STRIPE_WEBHOOK_SECRET", {
  isRequired: false,
});
export const STRIPE_BYPASS_COMPANY_IDS = getEnv("STRIPE_BYPASS_COMPANY_IDS", {
  isRequired: false,
});
export const UPSTASH_REDIS_REST_URL = getEnv("UPSTASH_REDIS_REST_URL", {
  isRequired: false,
});
export const UPSTASH_REDIS_REST_TOKEN = getEnv("UPSTASH_REDIS_REST_TOKEN", {
  isRequired: false,
});
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days;
export const REFRESH_ACCESS_TOKEN_THRESHOLD = 60 * 10; // 10 minutes left before token expires
export const VERCEL_URL = getEnv("VERCEL_URL", { isSecret: false });

/**
 * Shared envs
 */
export const VERCEL_ENV = getEnv("VERCEL_ENV", {
  isSecret: false,
  isRequired: false,
});
export const NODE_ENV = getEnv("NODE_ENV", {
  isSecret: false,
  isRequired: false,
});
export const POSTHOG_API_HOST = getEnv("POSTHOG_API_HOST", {
  isSecret: false,
});
export const POSTHOG_PROJECT_PUBLIC_KEY = getEnv("POSTHOG_PROJECT_PUBLIC_KEY", {
  isSecret: false,
});
export const SUPABASE_URL = getEnv("SUPABASE_URL", { isSecret: false });
export const SUPABASE_ANON_KEY = getEnv("SUPABASE_ANON_KEY", {
  isSecret: false,
});
export const CLOUDFLARE_TURNSTILE_SITE_KEY = getEnv(
  "CLOUDFLARE_TURNSTILE_SITE_KEY",
  { isSecret: false, isRequired: false }
);
export const CLOUDFLARE_TURNSTILE_SECRET_KEY = getEnv(
  "CLOUDFLARE_TURNSTILE_SECRET_KEY",
  { isRequired: false }
);

export function getAppUrl() {
  if (VERCEL_ENV === "production" || NODE_ENV === "production") {
    return CONTROLLED_ENVIRONMENT
      ? "https://itar.carbon.ms"
      : "https://app.carbon.ms";
  }

  if (VERCEL_ENV === "preview") {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

export function getMESUrl() {
  if (VERCEL_ENV === "production" || NODE_ENV === "production") {
    return CONTROLLED_ENVIRONMENT
      ? "https://mes.itar.carbon.ms"
      : "https://mes.carbon.ms";
  }

  if (VERCEL_ENV === "preview") {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3001";
}

export function getBrowserEnv() {
  return {
    CARBON_EDITION,
    CONTROLLED_ENVIRONMENT,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    POSTHOG_API_HOST,
    POSTHOG_PROJECT_PUBLIC_KEY,
    NOVU_APPLICATION_ID,
    VERCEL_ENV,
    VERCEL_URL,
    NODE_ENV,
    CLOUDFLARE_TURNSTILE_SITE_KEY,
  };
}

export function isVercel() {
  return VERCEL_URL.includes("vercel.app");
}
