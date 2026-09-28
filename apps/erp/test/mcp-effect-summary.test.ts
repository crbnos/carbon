import * as path from "node:path";
import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import {
  buildEffectIndex,
  createSqlEffectResolver,
  sqlBodyWrite
} from "../../../scripts/lib/effect-summary";
import type { ServiceProject } from "../../../scripts/lib/response-schema";
import {
  CLASSIFICATION_OVERRIDES,
  checkClassification,
  isPublishableExport
} from "../../../scripts/lib/service-metadata";

// Unit tests for the effect checker behind the MCP tool classification
// (scripts/lib/effect-summary.ts + checkClassification). The generator fails
// when a READ-named export changes state or a WRITE-named one changes none, so
// each detector here is a way a tool could be published with a lying
// readOnlyHint — or a pure read gated on `update`.

const REPO_ROOT = path.resolve(__dirname, "../../..");

/** Fixture service files live under the repo root so calls into them are followed. */
function serviceProject(files: Record<string, string>): ServiceProject {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true }
  });
  const sources = Object.entries(files).map(([name, code]) => ({
    mod: "fixture",
    source: project.createSourceFile(
      path.join(REPO_ROOT, "fixture", name),
      code
    )
  }));
  return {
    project,
    sources: sources.filter((s) => s.source.getBaseName().endsWith(".service.ts"))
  };
}

const noSql = () => undefined;

function effectsOf(
  code: string,
  fn: string,
  extra: Record<string, string> = {},
  sql: (name: string) => string | null | undefined = noSql
) {
  const index = buildEffectIndex(
    serviceProject({ "fixture.service.ts": code, ...extra }),
    sql
  );
  return index.get("fixture", fn);
}

describe("buildEffectIndex", () => {
  it("finds a supabase table write in the export's own body", () => {
    const effects = effectsOf(
      `export async function renameThing(client: any, id: string) {
         return client.from("thing").update({ name: "x" }).eq("id", id);
       }`,
      "renameThing"
    );
    expect(effects).toEqual([
      { kind: "table-write", detail: "thing.update", via: [] }
    ]);
  });

  it("follows a write through a same-repo helper, with the call chain", () => {
    const effects = effectsOf(
      `import { persist } from "./helper";
       export async function getOrMakeThing(client: any) {
         const found = await client.from("thing").select("*");
         if (!found.data?.length) await persist(client);
         return found;
       }`,
      "getOrMakeThing",
      {
        "helper.ts": `export async function persist(client: any) {
          await client.from("thing").insert({ id: "1" });
        }`
      }
    );
    expect(effects?.[0]).toMatchObject({
      kind: "table-write",
      detail: "thing.insert",
      via: ["persist"]
    });
  });

  it("does not mistake Map/Set mutation or storage reads for writes", () => {
    const effects = effectsOf(
      `export async function lookupThing(client: any, ids: string[]) {
         const seen = new Map<string, number>();
         seen.delete("a");
         new Set(ids).delete("b");
         await client.from("storageUnit").select("id");
         await client.storage.from("bucket").list("dir");
         return seen;
       }`,
      "lookupThing"
    );
    expect(effects).toEqual([]);
  });

  it("treats storage uploads, edge functions and job triggers as effects", () => {
    const code = `
      import { trigger } from "./jobs";
      export async function attachFile(client: any) {
        return client.storage.from("private").upload("a.pdf", new Blob());
      }
      export async function postThing(client: any) {
        return client.functions.invoke("post-thing", { body: {} });
      }
      export async function notifyThing(companyId: string) {
        await trigger("thing-changed", { companyId });
      }`;
    const index = buildEffectIndex(
      serviceProject({
        "fixture.service.ts": code,
        "jobs.ts": "export async function trigger(name: string, data: unknown) {}"
      }),
      noSql
    );
    expect(index.get("fixture", "attachFile")?.[0]?.kind).toBe("storage-write");
    expect(index.get("fixture", "postThing")?.[0]?.kind).toBe("edge-function");
    expect(index.get("fixture", "notifyThing")?.[0]?.kind).toBe("job-trigger");
  });

  it("reads Kysely builders and raw sql templates", () => {
    const code = `
      declare const sql: any;
      export async function reorderThings(db: any, companyId: string) {
        return sql\`UPDATE \${sql.table("thing")} AS t SET "sortOrder" = 1 WHERE t."companyId" = \${companyId}\`.execute(db);
      }
      export async function archiveThing(db: any) {
        return db.updateTable("thing").set({ archived: true }).execute();
      }
      export async function countThings(db: any) {
        return sql\`SELECT count(*) FROM thing\`.execute(db);
      }`;
    const index = buildEffectIndex(
      serviceProject({ "fixture.service.ts": code }),
      noSql
    );
    expect(index.get("fixture", "reorderThings")?.[0]?.kind).toBe("sql-write");
    expect(index.get("fixture", "archiveThing")?.[0]?.kind).toBe("kysely-write");
    expect(index.get("fixture", "countThings")).toEqual([]);
  });

  it("classifies rpc calls by the database function's body, not its name", () => {
    const sql = (name: string) =>
      ({ get_next_sequence: "UPDATE sequence", get_aging: null })[name];
    const code = `
      export async function getNextSequence(client: any, table: string) {
        return client.rpc("get_next_sequence", { sequence_name: table });
      }
      export async function getAging(client: any) {
        return client.rpc("get_aging" as unknown as "x", {});
      }
      export async function getMystery(client: any) {
        return client.rpc("not_in_migrations", {});
      }`;
    const index = buildEffectIndex(
      serviceProject({ "fixture.service.ts": code }),
      sql
    );
    expect(index.get("fixture", "getNextSequence")?.[0]).toMatchObject({
      kind: "rpc-write",
      detail: "rpc get_next_sequence: UPDATE sequence"
    });
    expect(index.get("fixture", "getAging")).toEqual([]);
    // Unknown → an effect until RPC_EFFECTS says otherwise, so the checker
    // cannot silently wave through a READ-named mutation.
    expect(index.get("fixture", "getMystery")?.[0]?.kind).toBe(
      "rpc-unresolved"
    );
  });
});

describe("sqlBodyWrite", () => {
  it("flags INSERT/UPDATE/DELETE and sequence consumption", () => {
    expect(sqlBodyWrite(`INSERT INTO "journal" VALUES (1)`)).toBe(
      "INSERT INTO journal"
    );
    expect(sqlBodyWrite(`UPDATE public."sequence" s SET next = next + 1`)).toBe(
      "UPDATE sequence"
    );
    expect(sqlBodyWrite("DELETE FROM thing WHERE id = 1")).toBe(
      "DELETE FROM thing"
    );
    expect(sqlBodyWrite("SELECT nextval('x')")).toBe("nextval()");
  });

  it("ignores reads, row locks, comments and scratch temp tables", () => {
    expect(sqlBodyWrite("SELECT * FROM job FOR UPDATE")).toBeNull();
    expect(sqlBodyWrite("SELECT 1 -- then UPDATE thing SET x = 1")).toBeNull();
    expect(
      sqlBodyWrite(`
        CREATE TEMP TABLE scratch AS SELECT 1;
        INSERT INTO scratch SELECT 2;
        UPDATE scratch SET x = 1;
        SELECT * FROM scratch;`)
    ).toBeNull();
  });

  it("follows calls into other writing SQL functions", () => {
    const resolve = createSqlEffectResolver(
      new Map([
        ["outer_read", [{ name: "outer_read", body: "SELECT inner_write(1)" }]],
        [
          "inner_write",
          [{ name: "inner_write", body: "INSERT INTO audit VALUES (1)" }]
        ],
        ["pure_read", [{ name: "pure_read", body: "SELECT 1" }]]
      ])
    );
    expect(resolve("outer_read")).toBe("inner_write → INSERT INTO audit");
    expect(resolve("pure_read")).toBeNull();
    expect(resolve("unknown_fn")).toBeUndefined();
  });

  it("resolves the real get_next_sequence from the migrations as a write", () => {
    expect(createSqlEffectResolver()("get_next_sequence")).toMatch(
      /UPDATE sequence/
    );
  });
});

describe("checkClassification", () => {
  const write = [{ kind: "table-write" as const, detail: "x.insert", via: [] }];

  it("passes when name and code agree", () => {
    expect(checkClassification("m_getThing", "READ", [])).toBeNull();
    expect(checkClassification("m_updateThing", "WRITE", write)).toBeNull();
    expect(checkClassification("m_deleteThing", "DESTRUCTIVE", write)).toBeNull();
  });

  it("fails a READ-named export that changes state", () => {
    expect(checkClassification("m_getThing", "READ", write)?.kind).toBe(
      "read-named-with-effect"
    );
  });

  it("fails a WRITE-named export that changes nothing", () => {
    expect(checkClassification("m_resolveThing", "WRITE", [])?.kind).toBe(
      "write-named-without-effect"
    );
  });

  it("accepts a disagreement an override settles, and flags a stale one", () => {
    const [name] = Object.keys(CLASSIFICATION_OVERRIDES);
    expect(checkClassification(name, "READ", write)).toBeNull();
    expect(checkClassification(name, "READ", [])?.kind).toBe("stale-override");
  });

  it("every override carries a reason", () => {
    for (const [name, entry] of Object.entries(CLASSIFICATION_OVERRIDES)) {
      expect(entry.reason.length, name).toBeGreaterThan(20);
    }
  });
});

describe("isPublishableExport", () => {
  it("skips @deprecated exports", () => {
    expect(
      isPublishableExport({
        params: [{ name: "client" }],
        jsdoc: " @deprecated Use insertThing for new things "
      })
    ).toBe(false);
  });

  it("skips pure helpers that take no client, db or company context", () => {
    expect(
      isPublishableExport({ params: [{ name: "priceBreaks" }, { name: "qty" }] })
    ).toBe(false);
    expect(isPublishableExport({ params: [] })).toBe(false);
  });

  it("keeps ordinary service functions", () => {
    expect(
      isPublishableExport({
        params: [{ name: "client" }, { name: "id" }],
        jsdoc: " Fetch a thing by id "
      })
    ).toBe(true);
    expect(
      isPublishableExport({ params: [{ name: "companyId" }, { name: "kind" }] })
    ).toBe(true);
  });
});
