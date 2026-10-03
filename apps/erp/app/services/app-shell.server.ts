// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { PrinterRoute } from "@carbon/printing";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withLogoUrls } from "~/modules/settings";

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];

// What `get_app_shell` returns: the rows the shell used to read with nine
// requests. Each key holds what `select("*")` on that table returned.
type AppShellRows = {
  companies: Views["companies"]["Row"][];
  companyIntegrations: Tables["companyIntegration"]["Row"][];
  companySettings: Tables["companySettings"]["Row"] | null;
  savedViews: Tables["tableView"]["Row"][];
  user: Tables["user"]["Row"] | null;
  groups: string[];
  defaults: Views["userDefaults"]["Row"] | null;
  modulePreferences: Pick<
    Tables["userModulePreference"]["Row"],
    "module" | "position" | "hidden"
  >[];
  printerRoutes: PrinterRoute[];
  implementationHub: Tables["implementationHub"]["Row"] | null;
};

/**
 * Everything the app shell reads about the user and the company, in one round
 * trip. `client` is the user's own client: the function runs as them, so each
 * table's RLS applies as it did when these were separate requests.
 */
export async function getAppShell(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
) {
  const result = await client.rpc("get_app_shell", {
    company_id: companyId,
    user_id: userId
  });
  if (result.error || !result.data) {
    return { data: null, error: result.error ?? new Error("Empty app shell") };
  }
  const rows = result.data as unknown as AppShellRows;
  return {
    data: { ...rows, companies: rows.companies.map(withLogoUrls) },
    error: null
  };
}
