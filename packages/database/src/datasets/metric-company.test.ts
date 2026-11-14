// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database, like the drift check:
//   SUPABASE_DB_URL=… pnpm --filter @carbon/database test -- metric-company
//
// The transaction is always rolled back, so it writes nothing.

import { Client, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { unitOfMeasureCatalog } from "../units-of-measure.ts";
import { seedCompanyReferenceData } from "./bootstrap.ts";
import { applyDatasetTiers, DATASETS } from "./index.ts";
import { resolveCompanyTimeZone } from "./types.ts";
import { resolveCheckUserId } from "./verify.ts";

const url = process.env.SUPABASE_DB_URL;

const IMPERIAL_CODES = unitOfMeasureCatalog
  .filter((unit) => unit.group === "Imperial")
  .map((unit) => unit.code);

describe.skipIf(!url)("a demo dataset applied to a metric company", () => {
  it("turns on the imperial units the dataset uses, and adds back a deleted one", async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    const pg = client as unknown as PoolClient;
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL "app.sync_in_progress" = 'true'`);
      const userId = await resolveCheckUserId(pg);
      expect(userId).not.toBeNull();

      const { companyId } = await seedCompanyReferenceData(pg, {
        userId: userId!,
        companyName: "Metric Dataset Check"
      });
      // A metric company holds the imperial units inactive; this one has
      // also deleted Inch.
      await client.query(
        `UPDATE "unitOfMeasure" SET active = false WHERE "companyId" = $1 AND code = ANY($2::text[])`,
        [companyId, IMPERIAL_CODES]
      );
      await client.query(
        `DELETE FROM "unitOfMeasure" WHERE "companyId" = $1 AND code = 'INCH'`,
        [companyId]
      );

      await applyDatasetTiers(pg, {
        companyId,
        userId: userId!,
        dataset: DATASETS.satellite,
        timeZone: await resolveCompanyTimeZone(pg, companyId)
      });

      const units = await client.query<{ code: string; active: boolean }>(
        `SELECT code, active FROM "unitOfMeasure" WHERE "companyId" = $1`,
        [companyId]
      );
      const active = new Map(units.rows.map((row) => [row.code, row.active]));
      // The satellite dataset buys stock by the pound and measures in inches.
      expect(active.get("LB")).toBe(true);
      expect(active.get("INCH")).toBe(true);
      // An imperial unit it does not use stays off.
      expect(active.get("OZ")).toBe(false);
      const items = await client.query<{ count: string }>(
        `SELECT count(*) FROM item WHERE "companyId" = $1 AND "unitOfMeasureCode" = 'LB'`,
        [companyId]
      );
      expect(Number(items.rows[0]!.count)).toBeGreaterThan(0);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  }, 120_000);
});
