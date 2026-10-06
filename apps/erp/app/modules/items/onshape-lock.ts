// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { ruleError } from "~/utils/supabase";
import { onshapeOwnedFieldConflicts } from "./items.models";

// Not a `*.service.ts` on purpose: this guard runs inside the item writers
// that are the API/MCP contract, and must never become a tool of its own. Not
// a `.server` file either: `items.service.ts` is in the client bundle, and
// Vite refuses a server-only module there.

/**
 * Refuse an edit that would change a field Onshape owns on an item linked to
 * the Onshape panel. An edit that leaves those fields as they are passes: the
 * Properties sidebar posts on blur whether or not anything changed. A field
 * passed as `undefined` is one the caller is not writing.
 *
 * Returns the linked item ids, so a full-replace writer can leave the owned
 * fields out.
 */
export async function checkItemIdentityEdit(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    itemIds: string[];
    name?: string | null;
    description?: string | null;
  }
): Promise<
  | { data: { linkedItemIds: string[] }; error: null }
  | { data: null; error: PostgrestError | { message: string; code?: string } }
> {
  if (args.itemIds.length === 0) {
    return { data: { linkedItemIds: [] }, error: null };
  }

  const links = await client
    .from("externalIntegrationMapping")
    .select("entityId")
    .eq("companyId", args.companyId)
    .eq("entityType", "item")
    .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
    .in("entityId", args.itemIds);
  // A failed lookup is not "not linked": falling through would write over
  // values Onshape owns.
  if (links.error) return { data: null, error: links.error };
  const linkedItemIds = [...new Set(links.data.map((link) => link.entityId))];

  if (linkedItemIds.length === 0) {
    return { data: { linkedItemIds }, error: null };
  }

  const current = await client
    .from("item")
    .select("readableId, name, description")
    .eq("companyId", args.companyId)
    .in("id", linkedItemIds);
  if (current.error) return { data: null, error: current.error };

  const changed = onshapeOwnedFieldConflicts(current.data, {
    name: args.name,
    description: args.description
  });
  if (changed.length > 0) {
    const readableIds = [...new Set(changed.map((row) => row.readableId))];
    return {
      data: null,
      error: ruleError(
        `The short and long descriptions of ${readableIds.join(", ")} are managed in Onshape. Change them there, or detach the item from Onshape to edit them in Carbon.`
      )
    };
  }

  return { data: { linkedItemIds }, error: null };
}
