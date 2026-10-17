// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readFileSync } from "node:fs";
import type { Database } from "@carbon/database";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The local stack's PostgREST, as the service role, from the `.env.local` that
 * `crbn up` writes. The unit-test config stubs SUPABASE_URL and the key, so a
 * service function's Supabase reads need the real values from that file. Null
 * when there is no local stack: the tests that need it skip.
 */
export function localServiceRoleClient(): SupabaseClient<Database> | null {
  const file = [".env.local", "../../.env.local"].find((path) =>
    existsSync(path)
  );
  if (!file) return null;
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (match?.[1] && match[2] !== undefined) env[match[1]] = match[2].trim();
  }
  const port = env.PORT_API;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!port || !key) return null;
  return createClient<Database>(`http://localhost:${port}`, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
