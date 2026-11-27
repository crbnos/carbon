// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noDbClientInService } from "./no-db-client-in-service";

const DB_CLIENT_SERVICE =
  "apps/erp/app/modules/production/production.service.ts";

describe("noDbClientInService", () => {
  it("flags getProcessPool() in a service file", () => {
    const ts = "const pool = getProcessPool();";
    const v = noDbClientInService.scan(DB_CLIENT_SERVICE, ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("getProcessPool(");
  });

  it("flags getPostgresClient() in a service file", () => {
    const ts = "return getPostgresClient(pool, PostgresDriver);";
    expect(
      noDbClientInService.scan(DB_CLIENT_SERVICE, ts).map((v) => v.snippet)
    ).toEqual(["getPostgresClient(", "PostgresDriver"]);
  });

  it("flags a raw new Pool()", () => {
    const ts = "const pool = new Pool({ connectionString });";
    expect(noDbClientInService.scan(DB_CLIENT_SERVICE, ts)).toHaveLength(1);
  });

  it("flags getDatabaseClient() and getJobDatabaseClient() in a service file", () => {
    const ts = [
      'import { getDatabaseClient } from "~/services/database.server";',
      "const db = getDatabaseClient();",
      "await seed(getJobDatabaseClient(5), args);"
    ].join("\n");
    const v = noDbClientInService.scan(DB_CLIENT_SERVICE, ts);
    // The import names the getter without calling it; only the calls count.
    expect(v.map((x) => [x.line, x.snippet])).toEqual([
      [2, "getDatabaseClient("],
      [3, "getJobDatabaseClient("]
    ]);
  });

  it("ignores the getter named in a comment", () => {
    const ts = [
      "// The route passes getDatabaseClient() in as `db`.",
      "/**",
      " * Called with getDatabaseClient() from the route.",
      " */"
    ].join("\n");
    expect(noDbClientInService.scan(DB_CLIENT_SERVICE, ts)).toHaveLength(0);
  });

  it("allows a type-only import of the Kysely types", () => {
    const ts =
      'import type { Kysely, KyselyDatabase } from "@carbon/database/client";';
    expect(noDbClientInService.scan(DB_CLIENT_SERVICE, ts)).toHaveLength(0);
  });

  it("allows importing the sql template from kysely", () => {
    const ts = 'import { sql } from "kysely";';
    expect(noDbClientInService.scan(DB_CLIENT_SERVICE, ts)).toHaveLength(0);
  });

  it("allows a service that RECEIVES db and opens a transaction", () => {
    const ts = [
      "export async function updateOrder(db: Kysely<KyselyDatabase>, updates) {",
      "  return db.transaction().execute(async (trx) => {});",
      "}"
    ].join("\n");
    expect(noDbClientInService.scan(DB_CLIENT_SERVICE, ts)).toHaveLength(0);
  });

  it("does NOT scan .server.ts (the sanctioned home for a DB client)", () => {
    const ts =
      "const pool = getProcessPool(); getPostgresClient(pool, PostgresDriver);";
    expect(
      noDbClientInService.scan("apps/erp/app/services/database.server.ts", ts)
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
