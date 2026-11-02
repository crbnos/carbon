// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// `scripts/lib/id-lookups`: which operation lists the ids an input field takes.
import type { ManifestEntry } from "@carbon/api";
import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import {
  lookupSentence,
  resolveIdLookups,
  viewBaseTables
} from "../../../scripts/lib/id-lookups";
import { routerLeaves } from "../../../scripts/lib/service-fn-metadata";

const TABLES = new Set([
  "item",
  "modelUpload",
  "nonConformance",
  "nonConformanceType"
]);
const hasId = () => true;

describe("viewBaseTables", () => {
  const resolve = (sql: string, views: string[]) =>
    viewBaseTables(TABLES, new Set(views), [sql], hasId);

  it("reads a star view's id from its table, through an alias", async () => {
    const sql = `CREATE OR REPLACE VIEW "issues" WITH (SECURITY_INVOKER=true) AS
      SELECT ncr.*, nci."items" FROM "nonConformance" ncr
      LEFT JOIN (SELECT "nonConformanceId", 1 AS items FROM "nonConformanceItem") nci
        ON nci."nonConformanceId" = ncr."id";`;
    expect(await resolve(sql, ["issues"])).toEqual(
      new Map([["issues", "nonConformance"]])
    );
  });

  it("follows a CTE, and a view built on another view", async () => {
    const sql = `CREATE VIEW "parts" AS
        WITH latest AS (SELECT i.*, mu.id AS "modelUploadId" FROM "item" i JOIN "modelUpload" mu ON true)
        SELECT latest.* FROM latest;
      CREATE VIEW "activeParts" AS SELECT p.id, p.name FROM "parts" p;`;
    expect(await resolve(sql, ["parts", "activeParts"])).toEqual(
      new Map([
        ["parts", "item"],
        ["activeParts", "item"]
      ])
    );
  });

  it("leaves out a view whose id is not plainly one table's", async () => {
    const sql = `CREATE VIEW "unioned" AS SELECT id FROM "item" UNION SELECT id FROM "nonConformance";
      CREATE VIEW "computed" AS SELECT i.id || '-x' AS id FROM "item" i;
      CREATE VIEW "renamed" AS SELECT i."modelUploadId" AS id FROM "item" i;`;
    expect(await resolve(sql, ["unioned", "computed", "renamed"])).toEqual(
      new Map()
    );
  });

  it("takes the later of two definitions of a view", async () => {
    const sql = `CREATE VIEW "v" AS SELECT id FROM "item";
      CREATE OR REPLACE VIEW "v" AS SELECT id FROM "nonConformance";`;
    expect(await resolve(sql, ["v"])).toEqual(
      new Map([["v", "nonConformance"]])
    );
  });
});

describe("resolveIdLookups", () => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(
    "/quality.service.ts",
    `export function getIssueTypesList(client: any) { return client.from("nonConformanceType").select("id, name"); }
     export function getIssueTypes(client: any) { return client.from("nonConformanceType").select("*"); }
     export function insertIssue(client: any, data: any) { return client.from("nonConformance").insert(data); }
     export const getParts = (client: any) => client.from("parts").select("*");
     export function getMaterials(client: any) { return client.from("materials").select("*"); }`
  );
  project.createSourceFile(
    "/router.ts",
    `import * as service from "./quality.service";
     import { getMaterials as materials } from "./quality.service";
     declare function defineServiceFn(definition: any): any;
     const createIssue = defineServiceFn({ run: (ctx: any, input: any) => service.insertIssue(ctx.client, input) });
     const getIssueTypesList = defineServiceFn({ run: (ctx: any) => service.getIssueTypesList(ctx.client) });
     const getIssueTypes = defineServiceFn({ run: (ctx: any) => service.getIssueTypes(ctx.client) });
     const getParts = defineServiceFn({ run: (ctx: any) => service.getParts(ctx.client) });
     const getMaterials = defineServiceFn({ run: (ctx: any) => materials(ctx.client) });
     export const router = {
       quality: { createIssue, getIssueTypesList, getIssueTypes },
       items: { getParts, getMaterials }
     };`
  );
  const leaves = routerLeaves(project, "/router.ts");

  const rows = {
    type: "array",
    items: { type: "object", properties: { id: { type: "string" } } }
  };
  const tool = (name: string, rest: Partial<ManifestEntry>): ManifestEntry => ({
    name,
    module: name.split("_")[0]!,
    classification: "READ",
    description: "",
    permission: { module: "quality", actions: ["view"] },
    paginates: false,
    schema: { type: "object" },
    serviceFn: { path: name.split("_") },
    ...rest
  });
  const tools = [
    tool("quality_createIssue", {
      classification: "WRITE",
      schema: {
        type: "object",
        properties: {
          nonConformanceTypeId: { type: "string" },
          itemId: { type: "string" },
          lineId: { type: "string" },
          openDate: { type: "string" }
        }
      }
    }),
    tool("quality_getIssueTypesList", { responseSchema: rows }),
    tool("quality_getIssueTypes", { responseSchema: rows, paginates: true }),
    tool("items_getParts", { responseSchema: rows }),
    tool("items_getMaterials", { responseSchema: rows })
  ];

  const resolved = resolveIdLookups({
    tools,
    leaves,
    tables: TABLES,
    viewBases: new Map([
      ["parts", "item"],
      ["materials", "item"]
    ]),
    foreignKeys: new Map([
      [
        "nonConformance",
        new Map([
          ["nonConformanceTypeId", new Set(["nonConformanceType"])],
          ["itemId", new Set(["item"])]
        ])
      ]
    ])
  });
  const createIssue = resolved.get("quality_createIssue");

  it("links an id to the list of its table, preferring the `…List`", () => {
    expect(createIssue?.get("nonConformanceTypeId")).toEqual([
      "quality_getIssueTypesList"
    ]);
  });

  it("names every view-backed list of a table in the best tier", () => {
    expect(createIssue?.get("itemId")?.sort()).toEqual([
      "items_getMaterials",
      "items_getParts"
    ]);
  });

  it("links nothing it cannot place", () => {
    expect(createIssue?.has("lineId")).toBe(false);
    expect(createIssue?.has("openDate")).toBe(false);
  });

  it("writes one sentence naming the lookups", () => {
    expect(lookupSentence(["a_list"])).toBe("Ids come from a_list.");
    expect(lookupSentence(["a", "b", "c"])).toBe("Ids come from a, b or c.");
  });
});
