import type { Database } from "@carbon/database";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

// The readable document number (PAY-2026-09-000012, MAIN000031, …) of a new
// record. Not a `*.service.ts` on purpose: an allocate-a-number helper must
// not be scanned into the API/MCP manifest — `settings_getNextSequence` is
// already the public way to read a sequence.
//
// A create path calls this in the SERVICE, so the UI route and an API caller
// get the same rule: a number the user typed is kept, a blank one is
// allocated. Allocating in the route left API callers to insert a NULL into a
// NOT NULL column.

/**
 * The caller's own readable id when one was given, otherwise the next value of
 * `sequenceName` for the company.
 */
export async function getOrAllocateReadableId(
  client: SupabaseClient<Database>,
  sequenceName: string,
  companyId: string,
  provided?: string | null
): Promise<
  { data: string; error: null } | { data: null; error: PostgrestError }
> {
  if (provided) return { data: provided, error: null };

  const next = await client.rpc("get_next_sequence", {
    sequence_name: sequenceName,
    company_id: companyId
  });
  if (next.error || !next.data) {
    return {
      data: null,
      error:
        next.error ??
        ({
          message: `Failed to generate ${sequenceName} sequence`
        } as PostgrestError)
    };
  }
  return { data: next.data, error: null };
}
