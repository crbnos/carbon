// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { loadHelpers, validateHelper } from "./helpers";
import { syncAuthz } from "./sync";

const fn = (name: string, body = "SELECT 1") =>
  `CREATE OR REPLACE FUNCTION public.${name}() RETURNS integer LANGUAGE sql AS $$ ${body} $$;`;

describe("validateHelper: a helper file is one function, and the right one", () => {
  test("accepts exactly one CREATE OR REPLACE FUNCTION public.<name>", async () => {
    await expect(
      validateHelper({ name: "h", sql: fn("h") })
    ).resolves.toBeUndefined();
  });

  test("rejects a second statement smuggled in", async () => {
    await expect(
      validateHelper({ name: "h", sql: `${fn("h")} DROP TABLE item;` })
    ).rejects.toThrow();
  });

  test("rejects a function the file is not named for", async () => {
    await expect(
      validateHelper({ name: "h", sql: fn("other") })
    ).rejects.toThrow();
  });

  test("rejects CREATE without OR REPLACE", async () => {
    await expect(
      validateHelper({ name: "h", sql: fn("h").replace("OR REPLACE ", "") })
    ).rejects.toThrow();
  });

  test("every committed helper file passes", async () => {
    expect((await loadHelpers()).length).toBeGreaterThan(0);
  });
});

// Runs against the local database: SUPABASE_DB_URL=… pnpm vitest run src/authz
const url = process.env.SUPABASE_DB_URL;

describe.skipIf(!url)("syncHelpers against a migrated database", () => {
  const db = new Client({ connectionString: url });
  const name = `authz_helper_test_${process.pid}`;

  beforeAll(async () => {
    await db.connect();
    await db.query(fn(name));
  });

  afterAll(async () => {
    await db.query(`DROP FUNCTION IF EXISTS public.${name}()`);
    await db.query(`DROP FUNCTION IF EXISTS public.${name}(integer)`);
    await db.end();
  });

  test("replaces only a helper that differs, and a second run changes nothing", async () => {
    const helpers = [{ name, sql: fn(name, "SELECT 2") }];
    expect((await syncAuthz(db, {}, { helpers })).helpers).toEqual([name]);
    expect((await syncAuthz(db, {}, { helpers })).helpers).toEqual([]);
  });

  test("a signature change fails loudly and changes nothing", async () => {
    const helpers = [
      {
        name,
        sql: `CREATE OR REPLACE FUNCTION public.${name}(x integer) RETURNS integer LANGUAGE sql AS $$ SELECT x $$;`
      }
    ];
    await expect(syncAuthz(db, {}, { helpers })).rejects.toThrow(/signature/);
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM pg_proc WHERE proname = $1",
      [name]
    );
    expect(rows[0].n).toBe(1);
  });
});
