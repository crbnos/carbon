// Client-safe sales queries. Mirrors `main` — accept the Supabase client
// as an argument so callers (UI components) can pass the user's session
// client. Server callers should use sales.service.server.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getQuoteLines(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client
    .from("quoteLines")
    .select("*")
    .eq("quoteId", quoteId)
    .order("sortOrder", { ascending: true })
    .order("itemReadableId", { ascending: true });
}

export async function getQuoteLinePricesByQuoteId(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteId", quoteId)
    .order("quoteLineId", { ascending: true });
}
