// import type { User } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { devPrices } from "./seed/index.ts";
import type { Database } from "./types.ts";

dotenv.config({ path: ".env.local" });
dotenv.config();

const supabaseAdmin = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function seed() {
  const upsertConfig = await supabaseAdmin.from("config").upsert([
    {
      id: true,
      apiUrl: resolveApiUrl(),
      anonKey: process.env.SUPABASE_ANON_KEY!
    }
  ]);
  if (upsertConfig.error) throw upsertConfig.error;

  const upsertPlans = await supabaseAdmin.from("plan").upsert(
    Object.entries(devPrices).map(([id, { stripePriceId, name }]) => ({
      id,
      stripePriceId,
      name
    })),
    { onConflict: "id" }
  );

  if (upsertPlans.error) throw upsertPlans.error;

  await seedInstanceAdmin();
}

/**
 * Self-hosted installs run with GOTRUE_DISABLE_SIGNUP on, so somebody has
 * to exist before anybody can log in. When the deployment names an
 * instance admin (ADMIN_EMAIL, set by the BYOC control plane), create
 * that one account — its owner logs in via magic link and sets up the
 * first company through onboarding.
 *
 * No password and no company: this is an account, not a bootstrap. The
 * dev bootstrap (datasets/bootstrap.ts) stays what seeds a whole company.
 */
async function seedInstanceAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return;

  const { error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: {
      role: "employee",
      provider: "email",
      providers: ["email"]
    }
  });
  // Idempotent the cheap way: this runs on every upgrade, and the account
  // existing is the desired state, not a failure.
  if (error && error.code !== "email_exists") {
    throw new Error(`seed: creating instance admin: ${error.message}`);
  }
  console.log(`instance admin ${email} ${error ? "already exists" : "created"}`);
}

// Postgres triggers + edge functions call back to the API from inside the
// docker network, so the public portless hostname (https://<branch>.api.dev)
// won't resolve. Use host.docker.internal with the worktree's PORT_API
// (written to .env.local by `crbn up`). Cloud runs (e.g. CI seeding a fresh
// workspace) have no PORT_API and a `*.supabase.co` URL — return as-is.
function resolveApiUrl(): string {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const port = process.env.PORT_API;
  const isCrbnDevHost =
    /\.api\.dev(\/|$)/.test(supabaseUrl) || supabaseUrl.includes("localhost");
  if (!isCrbnDevHost) return supabaseUrl;
  if (!port) {
    throw new Error(
      "seed: SUPABASE_URL looks like a crbn dev host but PORT_API is unset — run via `crbn` so .env.local is loaded."
    );
  }
  return `http://host.docker.internal:${port}`;
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
