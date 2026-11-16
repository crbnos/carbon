// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tables with no `companyId` column. Their rows belong to a company through a
 * membership table: a user is in a company when `userToCompany` holds the pair.
 */
export const COMPANY_MEMBERSHIP: Record<
  string,
  { table: string; column: string } | undefined
> = {
  user: { table: "userToCompany", column: "userId" }
};

/**
 * `columns` of the rows of `table` that belong to `companyId`: by the row's own
 * `companyId`, else through its membership table. Row-level security already
 * scopes the read; this filter is the second lock, and for `user` the only one
 * that keeps out a user of another company the owner also belongs to.
 */
export function selectInCompany(
  client: SupabaseClient,
  table: string,
  columns: string,
  companyId: string
) {
  const membership = COMPANY_MEMBERSHIP[table];
  if (membership === undefined) {
    return client.from(table).select(columns).eq("companyId", companyId);
  }
  return client
    .from(table)
    .select(`${columns}, ${membership.table}!inner(companyId)`)
    .eq(`${membership.table}.companyId`, companyId);
}

/** A row read by `selectInCompany`, without the membership it was joined to. */
export function withoutMembership(
  table: string,
  row: Record<string, unknown>
): Record<string, unknown> {
  const membership = COMPANY_MEMBERSHIP[table];
  if (membership === undefined) return row;
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== membership.table)
  );
}
