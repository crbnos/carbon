// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PoolClient } from "pg";
import { getStandardUnitOfMeasure } from "../../units-of-measure.ts";
import type { Dataset } from "../types.ts";

/**
 * Every unit code the dataset names, read off any key ending in
 * `unitOfMeasureCode` (items, BOM lines, order lines, quality steps), so a
 * slice that adds one is covered without an edit here.
 */
export function datasetUnitOfMeasureCodes(dataset: Dataset): Set<string> {
  const codes = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string" && /unitOfMeasureCode$/i.test(key)) {
        codes.add(entry);
      } else {
        visit(entry);
      }
    }
  };
  visit(dataset);
  return codes;
}

/**
 * Makes every standard unit the dataset uses active in the company. A metric
 * company holds the imperial units the datasets name (LB, INCH) inactive; a
 * unit the company has deleted is added back. A unit is not added when the
 * company has one with its code or name in another case. The validator refuses
 * a code outside the catalog, so every code resolves here.
 */
export async function ensureUnitsOfMeasure(
  client: PoolClient,
  companyId: string,
  dataset: Dataset
): Promise<void> {
  const units = [...datasetUnitOfMeasureCodes(dataset)].flatMap((code) => {
    const unit = getStandardUnitOfMeasure(code);
    return unit ? [unit] : [];
  });
  if (units.length === 0) return;
  const names = units.map((u) => u.name);
  const codes = units.map((u) => u.code);
  await client.query(
    `INSERT INTO "unitOfMeasure" (name, code, "companyId", "createdBy")
     SELECT u.name, u.code, $1, 'system'
     FROM unnest($2::text[], $3::text[]) AS u(name, code)
     WHERE NOT EXISTS (
       SELECT 1 FROM "unitOfMeasure" x
       WHERE x."companyId" = $1
         AND (lower(x.code) = lower(u.code) OR lower(x.name) = lower(u.name))
     )
     ON CONFLICT DO NOTHING`,
    [companyId, names, codes]
  );
  await client.query(
    `UPDATE "unitOfMeasure" SET active = true
     WHERE "companyId" = $1 AND code = ANY($2::text[]) AND NOT active`,
    [companyId, codes]
  );
}
