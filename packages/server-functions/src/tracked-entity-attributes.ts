// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";

/**
 * `"attributes" @> {…}`: the containment form the `trackedEntity` GIN index
 * serves. `attributes->>'Key' = value` reads the same rows but cannot use the
 * index, so it walks every tracked entity of the company.
 */
export function attributesContain(values: Record<string, string>) {
  return sql<boolean>`"attributes" @> ${JSON.stringify(values)}::jsonb`;
}
