// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database, like the drift check:
//   SUPABASE_DB_URL=… pnpm --filter @carbon/database test -- units-of-measure-unique-code
//
// The transaction is always rolled back, so it writes nothing.

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const url = process.env.SUPABASE_DB_URL;

describe.skipIf(!url)("unit of measure codes", () => {
  it("refuses a code the company has in another case", async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    const companyId = `uomtest-${randomUUID().slice(0, 8)}`;

    const insertUnit = (code: string, name: string) =>
      client.query(
        `INSERT INTO "unitOfMeasure" (code, name, "companyId", "createdBy")
         VALUES ($1, $2, $3, 'system')`,
        [code, name, companyId]
      );

    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO company (id, name, "countryCode", "baseCurrencyCode", timezone)
         VALUES ($1, $1, 'NO', 'NOK', 'UTC')`,
        [companyId]
      );
      await insertUnit("kg", "Kilogram");

      const clash = await insertUnit("KG", "Kilo").then(
        () => null,
        (error: { code?: string }) => error
      );
      expect(clash?.code).toBe("23505");
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  }, 60_000);
});
