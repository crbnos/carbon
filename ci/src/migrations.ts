import { $ } from "execa";
import type { Customer } from "./client";
import { client } from "./client";
import { SUPABASE_ACCESS_TOKEN } from "./env";

async function migrate(): Promise<void> {
  console.log("✅ 🌱 Starting migrations");

  const { data: customers, error } = await client
    .from("decrypted_customer")
    .select("*");

  if (error) {
    console.error("🔴 🍳 Failed to fetch customers", error);
    return;
  }

  console.log("✅ 🛩️ Successfully retreived customers");

  console.log("👯‍♀️ Copying supabase folder");
  await $`cp -r ../packages/database/supabase .`;

  for await (const customer of customers as Customer[]) {
    try {
      console.log(`✅ 🥚 Migrating ${customer.name}`);
      const {
        database_url,
        decrypted_database_password,
        decrypted_service_role_key,
        project_id,
      } = customer;
      if (
        !database_url ||
        !project_id ||
        !decrypted_database_password ||
        !decrypted_service_role_key
      ) {
        console.log(`🔴🍳 Missing keys for ${customer.name}`);
        continue;
      }

      console.log(`✅ 🔑 Setting up environment for ${customer.name}`);

      let $$ = $({
        env: {
          SUPABASE_ACCESS_TOKEN:
            customer.decrypted_access_token === null
              ? SUPABASE_ACCESS_TOKEN
              : customer.decrypted_access_token,
          SUPABASE_API_URL: database_url,
          SUPABASE_DB_PASSWORD: decrypted_database_password,
          SUPABASE_PROJECT_ID: project_id,
          SUPABASE_SERVICE_ROLE: decrypted_service_role_key,
        },
        cwd: "supabase",
      });

      await $$`supabase link`;

      console.log(`✅ 🐣 Starting migrations for ${customer.name}`);
      await $$`supabase db push --include-all`;
      console.log(`✅ 🐣 Starting deployments for ${customer.name}`);
      await $$`supabase functions deploy`;

      if (!customer.seeded) {
        try {
          console.log(`✅ 🌱 Seeding ${customer.name}`);
          await $$`tsx ../../packages/database/src/seed.ts`;
          const { error } = await client
            .from("customer")
            .update({ seeded: true })
            .eq("id", customer.id);

          if (error) {
            throw new Error(
              `🔴 🍳 Failed to mark ${customer.name} as seeded: ${error.message}`
            );
          }

          // TODO: run the seed.sql file
        } catch (e) {
          console.error(`🔴 🍳 Failed to seed ${customer.name}`, e);
        }
      }

      console.log(`✅ 🐓 Successfully migrated ${customer.name}`);
    } catch (error) {
      console.error(`🔴 🍳 Failed to migrate ${customer.name}`, error);
    }
  }
}

migrate();
