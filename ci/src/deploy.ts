import { $ } from "execa";

import { client } from "./client";

export type Workspace = {
  id: number;
  name: string;
  slug: string;
  active: boolean;
  seeded: boolean;

  // AWS Configuration
  aws_account_id: string | null;
  aws_region: string | null;

  // Domain Configuration
  domain_name: string | null;
  domain_cert_arn: string | null;

  // Database Configuration
  connection_string: string | null;
  database_url: string | null;
  project_id: string | null;
  access_token: string | null;
  anon_key: string | null;
  database_password: string | null;
  jwt_key: string | null;
  service_role_key: string | null;
  carbon_edition: string | null;
  cloudflare_turnstile_secret_key: string | null;
  cloudflare_turnstile_site_key: string | null;
  controlled_environment: string | null;
  exchange_rates_api_key: string | null;
  novu_application_id: string | null;
  novu_secret_key: string | null;
  openai_api_key: string | null;
  posthog_api_host: string | null;
  posthog_project_public_key: string | null;
  resend_api_key: string | null;
  session_secret: string | null;
  slack_bot_token: string | null;
  slack_client_id: string | null;
  slack_client_secret: string | null;
  slack_oauth_redirect_url: string | null;
  slack_signing_secret: string | null;
  slack_state_secret: string | null;
  stripe_bypass_company_ids: string | null;
  stripe_secret_key: string | null;
  stripe_webhook_secret: string | null;
  trigger_api_url: string | null;
  trigger_project_id: string | null;
  trigger_secret_key: string | null;
  upstash_redis_rest_token: string | null;
  upstash_redis_rest_url: string | null;
  vercel_env: string | null;
  vercel_url: string | null;
};

async function deploy(): Promise<void> {
  console.log("✅ 🌱 Starting deployment");

  const { data: workspaces, error } = await client
    .from("workspaces")
    .select("*");

  if (error) {
    console.error("🔴 🍳 Failed to fetch workspaces", error);
    return;
  }

  console.log("✅ 🛩️ Successfully retreived workspaces");

  for await (const workspace of workspaces as Workspace[]) {
    try {
      console.log(`✅ 🥚 Migrating ${workspace.id}`);
      const {
        aws_account_id,
        aws_region,
        domain_name,
        domain_cert_arn,
        database_url,
        database_password,
        project_id,
        access_token,
        anon_key,
        service_role_key,
        carbon_edition,
        cloudflare_turnstile_secret_key,
        cloudflare_turnstile_site_key,
        controlled_environment,
        exchange_rates_api_key,
        novu_application_id,
        novu_secret_key,
        openai_api_key,
        posthog_api_host,
        posthog_project_public_key,
        resend_api_key,
        session_secret,
        slack_bot_token,
        slack_client_secret,
        slack_client_id,
        slack_oauth_redirect_url,
        slack_signing_secret,
        slack_state_secret,
        stripe_bypass_company_ids,
        stripe_secret_key,
        stripe_webhook_secret,
        trigger_api_url,
        trigger_project_id,
        trigger_secret_key,
        upstash_redis_rest_token,
        upstash_redis_rest_url,
        vercel_env,
        vercel_url,
      } = workspace;

      if (!aws_account_id) {
        console.log(`🔴🍳 Missing aws account id for ${workspace.id}`);
        continue;
      }

      if (!aws_region) {
        console.log(`🔴🍳 Missing aws region for ${workspace.id}`);
        continue;
      }

      if (!domain_name) {
        console.log(`🔴🍳 Missing domain name for ${workspace.id}`);
        continue;
      }

      if (!domain_cert_arn) {
        console.log(`🔴🍳 Missing domain cert arn for ${workspace.id}`);
        continue;
      }

      if (!database_url) {
        console.log(`🔴🍳 Missing database url for ${workspace.id}`);
        continue;
      }

      if (!database_password) {
        console.log(`🔴🍳 Missing database password for ${workspace.id}`);
        continue;
      }

      if (!project_id) {
        console.log(`🔴🍳 Missing project id for ${workspace.id}`);
        continue;
      }

      if (!access_token) {
        console.log(`🔴🍳 Missing access token for ${workspace.id}`);
        continue;
      }

      if (!anon_key) {
        console.log(`🔴🍳 Missing anon key for ${workspace.id}`);
        continue;
      }

      if (!service_role_key) {
        console.log(`🔴🍳 Missing service role key for ${workspace.id}`);
        continue;
      }

      if (!controlled_environment) {
        console.log(`🔴🍳 Missing controlled environment for ${workspace.id}`);
        continue;
      }

      if (!exchange_rates_api_key) {
        console.log(`🔴🍳 Missing exchange rates api key for ${workspace.id}`);
        continue;
      }

      if (!novu_application_id) {
        console.log(`🔴🍳 Missing novu application id for ${workspace.id}`);
        continue;
      }

      if (!novu_secret_key) {
        console.log(`🔴🍳 Missing novu secret key for ${workspace.id}`);
        continue;
      }

      if (!openai_api_key) {
        console.log(`🔴🍳 Missing openai api key for ${workspace.id}`);
        continue;
      }

      if (!posthog_api_host) {
        console.log(`🔴🍳 Missing posthog api host for ${workspace.id}`);
        continue;
      }

      if (!posthog_project_public_key) {
        console.log(
          `🔴🍳 Missing posthog project public key for ${workspace.id}`
        );
        continue;
      }

      if (!resend_api_key) {
        console.log(`🔴🍳 Missing resend api key for ${workspace.id}`);
        continue;
      }

      if (!session_secret) {
        console.log(`🔴🍳 Missing session secret for ${workspace.id}`);
        continue;
      }

      if (!trigger_api_url) {
        console.log(`🔴🍳 Missing trigger api url for ${workspace.id}`);
        continue;
      }

      if (!trigger_project_id) {
        console.log(`🔴🍳 Missing trigger project id for ${workspace.id}`);
        continue;
      }

      if (!trigger_secret_key) {
        console.log(`🔴🍳 Missing trigger secret key for ${workspace.id}`);
        continue;
      }

      if (!upstash_redis_rest_token) {
        console.log(
          `🔴🍳 Missing upstash redis rest token for ${workspace.id}`
        );
        continue;
      }

      if (!upstash_redis_rest_url) {
        console.log(`🔴🍳 Missing upstash redis rest url for ${workspace.id}`);
        continue;
      }

      if (!vercel_url) {
        console.log(`🔴🍳 Missing vercel url for ${workspace.id}`);
        continue;
      }

      console.log(`✅ 🔑 Setting up environment for ${workspace.id}`);

      const $$ = $({
        // @ts-ignore
        env: {
          AWS_ACCOUNT_ID: aws_account_id,
          AWS_REGION: aws_region,
          CARBON_EDITION: carbon_edition ?? "enterprise",
          CLOUDFLARE_TURNSTILE_SECRET_KEY: cloudflare_turnstile_secret_key,
          CLOUDFLARE_TURNSTILE_SITE_KEY: cloudflare_turnstile_site_key,
          CONTROLLED_ENVIRONMENT: controlled_environment,
          DOMAIN: domain_name,
          EXCHANGE_RATES_API_KEY: exchange_rates_api_key,
          NOVU_APPLICATION_ID: novu_application_id,
          NOVU_SECRET_KEY: novu_secret_key,
          OPENAI_API_KEY: openai_api_key,
          POSTHOG_API_HOST: posthog_api_host,
          POSTHOG_PROJECT_PUBLIC_KEY: posthog_project_public_key,
          RESEND_API_KEY: resend_api_key,
          SESSION_SECRET: session_secret,
          SLACK_BOT_TOKEN: slack_bot_token,
          SLACK_CLIENT_ID: slack_client_id,
          SLACK_CLIENT_SECRET: slack_client_secret,
          SLACK_OAUTH_REDIRECT_URL: slack_oauth_redirect_url,
          SLACK_SIGNING_SECRET: slack_signing_secret,
          SLACK_STATE_SECRET: slack_state_secret,
          STRIPE_BYPASS_COMPANY_IDS: stripe_bypass_company_ids,
          STRIPE_SECRET_KEY: stripe_secret_key,
          STRIPE_WEBHOOK_SECRET: stripe_webhook_secret,
          SUPABASE_ANON_KEY: anon_key,
          SUPABASE_ANON_PUBLIC: anon_key,
          SUPABASE_API_URL: database_url,
          SUPABASE_SERVICE_ROLE: service_role_key,
          SUPABASE_SERVICE_ROLE_KEY: service_role_key,
          SUPABASE_URL: database_url,
          TRIGGER_API_URL: trigger_api_url,
          TRIGGER_PROJECT_ID: trigger_project_id,
          TRIGGER_SECRET_KEY: trigger_secret_key,
          UPSTASH_REDIS_REST_TOKEN: upstash_redis_rest_token,
          UPSTASH_REDIS_REST_URL: upstash_redis_rest_url,
          VERCEL_ENV: vercel_env ?? "production",
          VERCEL_URL: vercel_url,
        },
        // Run SST from the repository root where sst.config.ts is located
        cwd: "..",
      });

      console.log(
        `🚀 🧰 Deploying infrastructure for ${workspace.id} with SST`
      );

      await $$`npx --yes sst deploy --stage prod`;

      console.log(`✅ 🐓 Successfully deployed ${workspace.id}`);
    } catch (error) {
      console.error(`🔴 🍳 Failed to deploy ${workspace.id}`, error);
    }
  }
}

deploy();
