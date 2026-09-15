import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { quoteLineValidator } from "./sales.models";
import { getQuoteLineItemIssue } from "./sales.server";
import { upsertQuoteLine as upsertQuoteLineRow } from "./sales.service";

// Server-only sales writes exposed as Carbon API / MCP operations. They cannot
// live in `sales.service.ts`: that file is re-exported by the `~/modules/sales`
// barrel, which client components value-import, so it is bundled for the
// browser and may not reference a `*.server` module. This file is never
// re-exported by the barrel; `scripts/generate-mcp.ts` and the API registry
// (`api+/v1+/lib/registry.server.ts`) pick it up server-side, and a same-named
// export here shadows the service function under the same tool name.

function refusal(message: string) {
  return { data: null, error: { message } };
}

/**
 * Upsert a quote line, refusing an item that cannot be quoted. Shadows the bare
 * `upsertQuoteLine` in `sales.service.ts` in the MCP/API registry, so the
 * published tool name and payload are unchanged, and it is also what the CSV
 * quote importer calls.
 *
 * The item rule is `getQuoteLineItemIssue`: an inactive item, or one minted by
 * a change order that has not been released, is refused unless the edited line
 * already points at it or another line of the quote already uses it. Its reads
 * run on a service-role client, because the change order read needs
 * `parts_view`; the write itself still goes through the caller's client.
 *
 * Returns the service's `{ data, error }` envelope, refusals included, so
 * callers handle a refused line the way they handle a failed insert.
 */
export async function upsertQuoteLine(
  client: SupabaseClient<Database>,
  quotationLine:
    | (Omit<z.infer<typeof quoteLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof quoteLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  // The insert branch requires it; on an update the API dispatch stamps it from
  // the caller's auth context. Without it there is no company to check against.
  const companyId = (quotationLine as { companyId?: string }).companyId;
  if (!companyId) {
    return refusal("A company is required to save a quote line.");
  }

  const serviceRole = getCarbonServiceRole();

  let currentItemId: string | null = null;
  if ("id" in quotationLine) {
    const existing = await serviceRole
      .from("quoteLine")
      .select("itemId")
      .eq("id", quotationLine.id)
      .eq("companyId", companyId)
      .maybeSingle();
    // A failed read says nothing about which item the line points at, so it
    // cannot be read as "unchanged".
    if (existing.error) {
      return refusal("This quote line could not be read. Try again.");
    }
    if (!existing.data) {
      return refusal("Failed to find quote line");
    }
    currentItemId = existing.data.itemId;
  }

  const issue = await getQuoteLineItemIssue(serviceRole, {
    companyId,
    quoteId: quotationLine.quoteId,
    itemId: quotationLine.itemId,
    currentItemId
  });
  if (issue) return refusal(issue);

  return upsertQuoteLineRow(client, quotationLine);
}
