// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database, like the drift check:
//   SUPABASE_DB_URL=… pnpm --filter @carbon/database test -- units-of-measure-backfill
//
// The transaction is always rolled back, so it writes nothing.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const url = process.env.SUPABASE_DB_URL;

const backfill = readFileSync(
  fileURLToPath(
    new URL(
      "../supabase/migrations/20261024044646_units-of-measure-master-list.sql",
      import.meta.url
    )
  ),
  "utf8"
);

// The list every company was seeded with before the master list.
const LEGACY_UNITS: [string, string][] = [
  ["EA", "Each"],
  ["CS", "Case"],
  ["PK", "Pack"],
  ["PL", "Pallet"],
  ["RL", "Roll"],
  ["BX", "Box"],
  ["BG", "Bag"],
  ["DR", "Drum"],
  ["GL", "Gallon"],
  ["LT", "Liter"],
  ["OZ", "Ounce"],
  ["LB", "Pound"],
  ["TN", "Ton"],
  ["YD", "Yard"],
  ["MT", "Meter"],
  ["INCH", "Inch"],
  ["FOOT", "Foot"]
];

describe.skipIf(!url)("the units-of-measure-master-list migration", () => {
  it("gives each company the units it lacks, active by its measurement system", async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    const prefix = `uomtest-${randomUUID().slice(0, 8)}`;

    const createCompany = async (
      key: string,
      countryCode: string | null,
      baseCurrencyCode: string,
      useMetric: boolean,
      extra: [string, string][] = []
    ) => {
      const companyId = `${prefix}-${key}`;
      await client.query(
        `INSERT INTO company (id, name, "countryCode", "baseCurrencyCode", timezone)
         VALUES ($1, $1, $2, $3, 'UTC')`,
        [companyId, countryCode, baseCurrencyCode]
      );
      // The company-insert interceptor sets useMetric from the country; the
      // companies created from 2026-04-10 got false whatever their country.
      await client.query(
        `UPDATE "companySettings" SET "useMetric" = $2 WHERE id = $1`,
        [companyId, useMetric]
      );
      const units = [...LEGACY_UNITS, ...extra];
      await client.query(
        `INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
         SELECT u.code, u.name, $1, 'system'
         FROM unnest($2::text[], $3::text[]) AS u(code, name)`,
        [companyId, units.map(([code]) => code), units.map(([, name]) => name)]
      );
      return companyId;
    };

    const unitsOf = async (companyId: string) => {
      const result = await client.query<{ code: string; active: boolean }>(
        `SELECT code, active FROM "unitOfMeasure" WHERE "companyId" = $1`,
        [companyId]
      );
      return new Map(result.rows.map((row) => [row.code, row.active]));
    };

    try {
      await client.query("BEGIN");
      const us = await createCompany("us", "US", "USD", false);
      // Metric off, as the April regression left it.
      const norway = await createCompany("no", "NO", "NOK", false);
      // Metric on, with the units it made by hand.
      const germany = await createCompany("de", "DE", "EUR", true, [
        ["KG", "Kilogram"],
        ["MM", "Millimeter"],
        ["SQM", "Square Meter"]
      ]);

      await client.query(backfill);

      const usUnits = await unitsOf(us);
      // Meter and Liter keep their codes; nothing is added beside them.
      expect(usUnits.get("MT")).toBe(true);
      expect(usUnits.get("LT")).toBe(true);
      expect(usUnits.has("m")).toBe(false);
      expect(usUnits.has("L")).toBe(false);
      expect(usUnits.get("FT2")).toBe(true);
      expect(usUnits.get("FT3")).toBe(true);
      expect(usUnits.get("kg")).toBe(false);
      expect(usUnits.get("mm")).toBe(false);
      expect(usUnits.size).toBe(27);

      const norwayUnits = await unitsOf(norway);
      expect(norwayUnits.get("kg")).toBe(true);
      expect(norwayUnits.get("m2")).toBe(true);
      expect(norwayUnits.get("FT2")).toBe(false);
      // The units it had are not changed.
      expect(norwayUnits.get("LB")).toBe(true);

      const germanyUnits = await unitsOf(germany);
      // A unit with the code in another case, or the name, is not added.
      expect(germanyUnits.get("KG")).toBe(true);
      expect(germanyUnits.has("kg")).toBe(false);
      expect(germanyUnits.has("mm")).toBe(false);
      expect(germanyUnits.has("m2")).toBe(false);
      expect(germanyUnits.get("g")).toBe(true);
      expect(germanyUnits.get("m3")).toBe(true);
      expect(germanyUnits.get("mL")).toBe(true);
      expect(germanyUnits.size).toBe(27);

      // Run again, it adds nothing.
      await client.query(backfill);
      expect((await unitsOf(germany)).size).toBe(27);

      // A code that differs only in case is refused.
      await client.query("SAVEPOINT clash");
      const clash = await client
        .query(
          `INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
           VALUES ('KG', 'Kilo', $1, 'system')`,
          [norway]
        )
        .then(
          () => null,
          (error: { code?: string }) => error
        );
      expect(clash?.code).toBe("23505");
      await client.query("ROLLBACK TO SAVEPOINT clash");
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  }, 60_000);
});
