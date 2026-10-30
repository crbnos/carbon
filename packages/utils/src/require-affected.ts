// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { NOT_APPLIED_CODE, NOT_APPLIED_TEXT } from "./error-reason";

/**
 * A single-record write that changed no row: RLS skipped it or the record is
 * gone, and Postgres reports neither as an error. Give the write
 * `.select("id")` so the changed rows come back, and wrap it.
 */
export async function requireAffected<
  R extends { error: unknown; data: unknown }
>(query: PromiseLike<R>): Promise<R> {
  const result = await query;
  if (
    result.error == null &&
    Array.isArray(result.data) &&
    result.data.length === 0
  ) {
    return {
      ...result,
      error: {
        name: "PostgrestError",
        code: NOT_APPLIED_CODE,
        message: NOT_APPLIED_TEXT,
        details: "",
        hint: ""
      }
    } as R;
  }
  return result;
}
