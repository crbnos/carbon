import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getUser(
  client: SupabaseClient<Database>,
  userId: string
) {
  return client
    .from("user")
    .select("*")
    .eq("id", userId)
    .eq("active", true)
    .maybeSingle();
}
