// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noDbClientInService } from "./no-db-client-in-service";

const SERVICE = "apps/erp/app/modules/production/production.service.ts";

describe("noDbClientInService", () => {
  it("flags getProcessPool() in a service file", () => {
    const ts = "const pool = getProcessPool();";
    const v = noDbClientInService.scan(SERVICE, ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("getProcessPool(");
  });

  it("flags getPostgresClient() in a service file", () => {
    const ts = "return getPostgresClient(pool, PostgresDriver);";
    // getPostgresClient( and PostgresDriver both match
    const v = noDbClientInService.scan(SERVICE, ts);
    expect(v).toHaveLength(2);
  });

  it("flags a raw new Pool()", () => {
    const ts = "const pool = new Pool({ connectionString });";
    expect(noDbClientInService.scan(SERVICE, ts)).toHaveLength(1);
  });

  it("flags the dynamic-import construction workaround", () => {
    const ts = [
      'const { getPostgresClient, getProcessPool } = await import("@carbon/database/client");',
      'const { PostgresDriver } = await import("kysely");',
      "return getPostgresClient(getProcessPool(), PostgresDriver);"
    ].join("\n");
    // We match construction CALLS, not the destructured import names: line 3's
    // getPostgresClient( + getProcessPool( + PostgresDriver, plus the
    // PostgresDriver on line 2 = 4. The workaround is caught at the point of use.
    expect(noDbClientInService.scan(SERVICE, ts)).toHaveLength(4);
  });

  it("allows a type-only import of the Kysely types", () => {
    const ts =
      'import type { Kysely, KyselyDatabase } from "@carbon/database/client";';
    expect(noDbClientInService.scan(SERVICE, ts)).toHaveLength(0);
  });

  it("allows importing the sql template from kysely", () => {
    const ts = 'import { sql } from "kysely";';
    expect(noDbClientInService.scan(SERVICE, ts)).toHaveLength(0);
  });

  it("allows a service that RECEIVES db and opens a transaction", () => {
    const ts = [
      "export async function updateOrder(db: Kysely<KyselyDatabase>, updates) {",
      "  return db.transaction().execute(async (trx) => {});",
      "}"
    ].join("\n");
    expect(noDbClientInService.scan(SERVICE, ts)).toHaveLength(0);
  });

  it("does NOT scan .server.ts (the sanctioned home for a DB client)", () => {
    const ts =
      "const pool = getProcessPool(); getPostgresClient(pool, PostgresDriver);";
    expect(
      noDbClientInService.scan("apps/erp/app/services/database.server.ts", ts)
    ).toHaveLength(0);
  });

  it("does NOT scan route files (they legitimately call getDatabaseClient)", () => {
    const ts = "const result = await runMRP(client, getDatabaseClient(), {});";
    expect(
      noDbClientInService.scan("apps/erp/app/routes/api+/mrp.ts", ts)
    ).toHaveLength(0);
  });

  it("does not confuse *.service.test.ts for a service file", () => {
    const ts = "const pool = getProcessPool();";
    expect(
      noDbClientInService.scan(
        "apps/erp/app/modules/production/production.service.test.ts",
        ts
      )
    ).toHaveLength(0);
  });
});
