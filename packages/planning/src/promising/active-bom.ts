// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import { type Kysely, sql } from "kysely";

export type ActiveBomLine = {
  parentItemId: string;
  childItemId: string;
  /** per one parent, in `unitOfMeasureCode` */
  quantity: number;
  unitOfMeasureCode: string;
  methodType: Database["public"]["Enums"]["methodType"];
};

/**
 * Every BOM line under the roots, through every level: the lines MRP explodes
 * (`bomChildren`). Each made item's method is the one `activeMakeMethods`
 * picks (Active first, then the highest version, never Archived), looked up
 * per item on ("companyId", "itemId") rather than through the view, whose
 * window would rank every method of the company at each level. No quantity-0
 * line (a configured item's other configurations), no correction material,
 * and an item whose replenishment is Buy is not exploded, a root included.
 *
 * UNION on the line id: a shared subassembly's lines come back once, and a
 * cycle stops when it reaches lines it already has.
 */
export async function loadActiveBomLines(
  db: Kysely<DB>,
  companyId: string,
  rootItemIds: string[]
): Promise<ActiveBomLine[]> {
  const roots = Array.from(new Set(rootItemIds));
  if (roots.length === 0) return [];

  const result = await sql<{
    parentItemId: string;
    childItemId: string;
    quantity: string | number;
    unitOfMeasureCode: string;
    methodType: ActiveBomLine["methodType"];
  }>`
    WITH RECURSIVE "line" AS (
      SELECT mm."id", i."id" AS "parentItemId", mm."itemId" AS "childItemId",
        mm."quantity", mm."unitOfMeasureCode", mm."methodType"
      FROM "item" i
      CROSS JOIN LATERAL (
        SELECT m."id" FROM "makeMethod" m
        WHERE m."companyId" = i."companyId" AND m."itemId" = i."id"
          AND m."status" <> 'Archived'
        ORDER BY (m."status" = 'Active') DESC, m."version" DESC
        LIMIT 1
      ) am
      JOIN "methodMaterial" mm
        ON mm."makeMethodId" = am."id" AND mm."companyId" = i."companyId"
        AND mm."quantity" > 0 AND mm."methodCorrectionId" IS NULL
      WHERE i."companyId" = ${companyId} AND i."id" = ANY(${roots}::text[])
        AND i."replenishmentSystem" <> 'Buy'
      UNION
      SELECT mm."id", i."id", mm."itemId", mm."quantity", mm."unitOfMeasureCode",
        mm."methodType"
      FROM "line" l
      JOIN "item" i
        ON i."id" = l."childItemId" AND i."companyId" = ${companyId}
        AND i."replenishmentSystem" <> 'Buy'
      CROSS JOIN LATERAL (
        SELECT m."id" FROM "makeMethod" m
        WHERE m."companyId" = i."companyId" AND m."itemId" = i."id"
          AND m."status" <> 'Archived'
        ORDER BY (m."status" = 'Active') DESC, m."version" DESC
        LIMIT 1
      ) am
      JOIN "methodMaterial" mm
        ON mm."makeMethodId" = am."id" AND mm."companyId" = i."companyId"
        AND mm."quantity" > 0 AND mm."methodCorrectionId" IS NULL
    )
    SELECT "parentItemId", "childItemId", "quantity", "unitOfMeasureCode", "methodType"
    FROM "line"
  `.execute(db);

  return result.rows.map((row) => ({ ...row, quantity: Number(row.quantity) }));
}
