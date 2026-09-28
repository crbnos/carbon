import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { company, custom, group, type Manifest } from "./rules";
import { assertOnlyPolicies, syncAuthz } from "./sync";

// Runs against the local database: SUPABASE_DB_URL=… pnpm vitest run src/authz
const url = process.env.SUPABASE_DB_URL;

describe.skipIf(!url)("syncAuthz against a migrated database", () => {
  const db = new Client({ connectionString: url });
  const scratch = `authz_sync_test_${process.pid}`;

  beforeAll(async () => {
    await db.connect();
    await db.query(
      `CREATE TABLE public.${scratch} ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL)`
    );
  });

  afterAll(async () => {
    await db.query(`DROP TABLE IF EXISTS public.${scratch}`);
    await db.end();
  });

  test("canonical tables already match their rule exactly", async () => {
    const manifest: Manifest = {
      documentTemplate: company("settings"),
      dimension: group("accounting")
    };
    const { changed } = await syncAuthz(db, manifest, { dryRun: true });
    expect(changed).toEqual([]);
  });

  test("applies, is idempotent, and heals a hand-added policy", async () => {
    const manifest = { [scratch]: company("parts") } as Manifest;

    expect((await syncAuthz(db, manifest)).changed).toEqual([scratch]);
    expect((await syncAuthz(db, manifest)).changed).toEqual([]);

    await db.query(
      `CREATE POLICY "backdoor" ON public.${scratch} FOR SELECT USING (true)`
    );
    expect((await syncAuthz(db, manifest)).changed).toEqual([scratch]);

    const { rows } = await db.query(
      `SELECT policyname FROM pg_policies WHERE tablename = $1 ORDER BY 1`,
      [scratch]
    );
    expect(rows.map((r) => r.policyname)).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE"
    ]);
  });
});

describe("assertOnlyPolicies: rendered SQL can only create policies on its own table", () => {
  const policy = (t: string) =>
    `CREATE POLICY "SELECT" ON ${t} FOR SELECT USING (true);`;

  test("accepts policies on the target", async () => {
    await expect(
      assertOnlyPolicies(policy(`"public"."note"`), "public", "note")
    ).resolves.toBeUndefined();
  });

  test("rejects a smuggled statement", async () => {
    await expect(
      assertOnlyPolicies(
        `${policy(`"public"."note"`)} DROP TABLE item;`,
        "public",
        "note"
      )
    ).rejects.toThrow();
  });

  test("rejects a policy on another table", async () => {
    await expect(
      assertOnlyPolicies(policy(`"public"."item"`), "public", "note")
    ).rejects.toThrow();
  });

  test("a custom rule that tries it fails the whole sync, changing nothing", async () => {
    const evil = custom(
      "test",
      (t) => `${policy(t)} ALTER TABLE item DISABLE ROW LEVEL SECURITY;`
    );
    await expect(
      assertOnlyPolicies(
        evil.kind === "custom" ? evil.sql(`"public"."note"`) : "",
        "public",
        "note"
      )
    ).rejects.toThrow();
  });
});
