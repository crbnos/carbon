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
  
  // Application Environment Variables
  autodesk_bucket_name: string | null;
  autodesk_client_id: string | null;
  autodesk_client_secret: string | null;
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
  trigger_api_url: string | null;
  trigger_project_id: string | null;
  trigger_secret_key: string | null;
  upstash_redis_rest_token: string | null;
  upstash_redis_rest_url: string | null;
};

async function migrate(): Promise<void> {
  console.log("✅ 🌱 Starting deployment");

  const { data: workspaces, error } = await client
    .from("workspaces")
    .select("*");

  if (error) {
    console.error("🔴 🍳 Failed to fetch workspaces", error);
    return;
  }

  console.log("✅ 🛩️ Successfully retreived workspaces");

  console.log("👯‍♀️ Copying supabase folder");
  await $`cp -r ../packages/database/supabase .`;

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
        autodesk_bucket_name,
        autodesk_client_id,
        autodesk_client_secret,
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
        slack_client_id,
        slack_client_secret,
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

      if (!autodesk_bucket_name) {  
        console.log(`🔴🍳 Missing autodesk bucket name for ${workspace.id}`);
        continue;
      }
      
      if (!autodesk_client_id) {
        console.log(`🔴🍳 Missing autodesk client id for ${workspace.id}`);
        continue;
      }

      if (!autodesk_client_secret) {
        console.log(`🔴🍳 Missing autodesk client secret for ${workspace.id}`);
        continue;
      }

      if (!carbon_edition) {

      if (!cloudflare_turnstile_secret_key) {
        console.log(`🔴🍳 Missing cloudflare turnstile secret key for ${workspace.id}`);
        continue;
      }

      if (!cloudflare_turnstile_site_key) {

      if (!controlled_environment) {
        console.log(`🔴🍳 Missing controlled environment for ${workspace.id}`);
        continue;
      }

      if (!exchange_rates_api_key) {

      if (!novu_application_id) {
        console.log(`🔴🍳 Missing novu application id for ${workspace.id}`);
        continue;
      }

      if (!novu_secret_key) {

      if (!openai_api_key) {
        console.log(`🔴🍳 Missing openai api key for ${workspace.id}`);
        continue;
      }

      if (!posthog_api_host) {  
        console.log(`🔴🍳 Missing posthog api host for ${workspace.id}`);
        continue;
      }

      if (!posthog_project_public_key) {
        console.log(`🔴🍳 Missing posthog project public key for ${workspace.id}`);
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

      if (!slack_bot_token) {
        console.log(`🔴🍳 Missing slack bot token for ${workspace.id}`);
        continue;
      }

      if (!slack_client_id) {
        console.log(`🔴🍳 Missing slack client id for ${workspace.id}`);
        continue;
      }

      if (!slack_client_secret) {
        console.log(`🔴🍳 Missing slack client secret for ${workspace.id}`);
        continue;
      }

      if (!slack_oauth_redirect_url) {
        console.log(`🔴🍳 Missing slack oauth redirect url for ${workspace.id}`);
        continue;
      }

      if (!slack_signing_secret) {
        console.log(`🔴🍳 Missing slack signing secret for ${workspace.id}`);
        continue;
      }

      if (!slack_state_secret) {
        console.log(`🔴🍳 Missing slack state secret for ${workspace.id}`);
        continue;
      }

      if (!stripe_bypass_company_ids) {
        console.log(`🔴🍳 Missing stripe bypass company ids for ${workspace.id}`);
        continue;
      }

      if (!stripe_secret_key) {
        console.log(`🔴🍳 Missing stripe secret key for ${workspace.id}`);
        continue;
      }

      if (!stripe_webhook_secret) {
        console.log(`🔴🍳 Missing stripe webhook secret for ${workspace.id}`);
        continue;
      }

      if (!trigger_api_url) {

      console.log(`✅ 🔑 Setting up environment for ${workspace.id}`);

      let $$ = $({
        env: {
          SUPABASE_ACCESS_TOKEN:
            access_token === null ? SUPABASE_ACCESS_TOKEN : access_token,
          SUPABASE_URL: database_url ?? undefined,
          SUPABASE_DB_PASSWORD: database_password ?? undefined,
          SUPABASE_PROJECT_ID: project_id ?? undefined,
          SUPABASE_ANON_KEY: anon_key ?? undefined,
          SUPABASE_SERVICE_ROLE_KEY: service_role_key ?? undefined,
          SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID,
          SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET,
          SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI,
        },
        cwd: "supabase",
      });

      if (project_id) {
        await $$`supabase link`;
      }

      console.log(`✅ 🐣 Starting migrations for ${workspace.id}`);

      if (connection_string && connection_string.startsWith("postgresql://")) {
        await $$`supabase db push --db-url ${connection_string} --include-all`;
      } else {
        await $$`supabase db push --include-all`;
        console.log(`✅ 🐣 Starting deployments for ${workspace.id}`);
        await $$`supabase functions deploy`;
      }

      if (!workspace.seeded) {
        try {
          console.log(`✅ 🌱 Seeding ${workspace.id}`);
          await $$`tsx ../../packages/database/src/seed.ts`;
          const { error } = await client
            .from("workspaces")
            .update({ seeded: true })
            .eq("id", workspace.id);

          if (error) {
            throw new Error(
              `🔴 🍳 Failed to mark ${workspace.id} as seeded: ${error.message}`
            );
          }

          // TODO: run the seed.sql file
        } catch (e) {
          console.error(`🔴 🍳 Failed to seed ${workspace.id}`, e);
        }
      }

      console.log(`✅ 🐓 Successfully migrated ${workspace.id}`);
    } catch (error) {
      console.error(`🔴 🍳 Failed to migrate ${workspace.id}`, error);
    }
  }
}

migrate();
