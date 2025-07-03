// import type { User } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { devPrices } from "./seed/index";
import type { Database } from "./types";

dotenv.config();

const supabaseAdmin = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

async function seed() {
  const upsertConfig = await supabaseAdmin.from("config").upsert([
    {
      id: true,
      apiUrl: process.env.SUPABASE_URL!.includes("localhost")
        ? "http://host.docker.internal:54321"
        : process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY!,
    },
  ]);
  if (upsertConfig.error) throw upsertConfig.error;

  const upsertPlans = await supabaseAdmin.from("plan").upsert(
    Object.entries(devPrices).map(([id, { stripePriceId, name }]) => ({
      id,
      stripePriceId,
      name,
    })),
    { onConflict: "id" }
  );

  if (upsertPlans.error) throw upsertPlans.error;
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
