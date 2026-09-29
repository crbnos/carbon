import { sql } from "kysely";

/**
 * `"attributes" @> {…}`: the containment form the `trackedEntity` GIN index
 * serves. `attributes->>'Key' = value` reads the same rows but cannot use the
 * index, so it walks every tracked entity of the company.
 */
export function attributesContain(values: Record<string, string>) {
  return sql<boolean>`"attributes" @> ${JSON.stringify(values)}::jsonb`;
}
