import { $ } from "execa";

import { client } from "./client";
import {
  SUPABASE_ACCESS_TOKEN,
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID,
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET,
  SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI,
} from "./env";

export type Workspace = {
  id: number;
  name: string;
  slug: string;
  active: boolean;
  seeded: boolean;
  connection_string: string | null;
  database_url: string | null;
  project_id: string | null;
  access_token: string | null;
  anon_key: string | null;
  database_password: string | null;
  jwt_key: string | null;
  service_role_key: string | null;
};

async function migrate(): Promise<void> {
  console.log("✅ 🌱 Starting migrations");

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
        connection_string,
        database_url,
        database_password,
        service_role_key,
        project_id,
        anon_key,
        access_token,
      } = workspace;
      if (!database_url) {
        console.log(`🔴🍳 Missing database url for ${workspace.id}`);
        continue;
      }

      console.log(`✅ 🔑 Setting up environment for ${workspace.id}`);

      let $$ = $({
        // @ts-ignore
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
