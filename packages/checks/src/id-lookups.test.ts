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
  type ViewBase,
  viewBaseTables
} from "../../../scripts/lib/id-lookups";
import { routerLeaves } from "../../../scripts/lib/service-fn-metadata";

const TABLES = new Set([
  "employee",
  "item",
  "job",
  "jobOperation",
  "modelUpload",
  "nonConformance",
  "nonConformanceType"
]);
const hasId = () => true;
const base = (
  table: string,
  equalities: [string, string][] = []
): ViewBase => ({
  table,
  equalities: new Map(equalities)
});

describe("viewBaseTables", () => {
  const resolve = (sql: string, views: string[]) =>
    viewBaseTables(TABLES, new Set(views), [{ name: "test.sql", sql }], hasId);

  it("reads a star view's id from its table, through an alias", async () => {
    const sql = `CREATE OR REPLACE VIEW "issues" WITH (SECURITY_INVOKER=true) AS
      SELECT ncr.*, nci."items" FROM "nonConformance" ncr
      LEFT JOIN (SELECT "nonConformanceId", 1 AS items FROM "nonConformanceItem") nci
        ON nci."nonConformanceId" = ncr."id";`;
    expect(await resolve(sql, ["issues"])).toEqual(
      new Map([["issues", base("nonConformance")]])
    );
  });

  it("follows a CTE and a view on a view, keeping their text filters", async () => {
    const sql = `CREATE VIEW "parts" AS
        WITH latest AS (
          SELECT i.*, mu.id AS "modelUploadId" FROM "item" i JOIN "modelUpload" mu ON true
          WHERE i."type" = 'Part' AND i."active"
        )
        SELECT latest.* FROM latest;
      CREATE VIEW "activeParts" AS SELECT p.id, p.name FROM "parts" p WHERE p."status" = 'Active';`;
    expect(await resolve(sql, ["parts", "activeParts"])).toEqual(
      new Map([
        ["parts", base("item", [["type", "Part"]])],
        [
          "activeParts",
          base("item", [
            ["type", "Part"],
            ["status", "Active"]
          ])
        ]
      ])
    );
  });

  it("leaves out a view whose id is not plainly one table's", async () => {
    const sql = `CREATE VIEW "unioned" AS SELECT id FROM "item" UNION SELECT id FROM "nonConformance";
      CREATE VIEW "computed" AS SELECT i.id || '-x' AS id FROM "item" i;
      CREATE VIEW "renamed" AS SELECT i."modelUploadId" AS id FROM "item" i;
      CREATE VIEW "fromSubquery" AS SELECT id FROM (SELECT 'x' AS id) s CROSS JOIN "item";
      CREATE VIEW "fromFunction" AS SELECT id FROM "item", generate_series(1, 2) g;`;
    expect(
      await resolve(sql, [
        "unioned",
        "computed",
        "renamed",
        "fromSubquery",
        "fromFunction"
      ])
    ).toEqual(new Map());
  });

  it("takes the later of two definitions of a view", async () => {
    const sql = `CREATE VIEW "v" AS SELECT id FROM "item";
      CREATE OR REPLACE VIEW "v" AS SELECT id FROM "nonConformance";`;
    expect(await resolve(sql, ["v"])).toEqual(
      new Map([["v", base("nonConformance")]])
    );
  });

  it("skips a source that does not parse and reads the others", async () => {
    const sources = [
      { name: "good.sql", sql: `CREATE VIEW "v" AS SELECT id FROM "item";` },
      { name: "broken.sql", sql: `CREATE VIEW "v" AS SELECT FROM WHERE;` }
    ];
    expect(
      await viewBaseTables(TABLES, new Set(["v"]), sources, hasId)
    ).toEqual(new Map([["v", base("item")]]));
  });
});

describe("resolveIdLookups", () => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(
    "/apps/erp/app.service.ts",
    `export function getIssueTypesList(client: any) { Array.from("ab"); return client.from("nonConformanceType").select("id, name"); }
     export function getTypesList(client: any, table: string) { client.from(table).select("id"); return client.from("nonConformanceType").select("id"); }
     export function getIssueTypes(client: any) { return client.from("nonConformanceType").select("*"); }
     export function insertIssue(client: any, data: any) { return writeIssue(client, data); }
     function writeIssue(client: any, data: any) { return client.from("nonConformance").insert(data); }
     export const getParts = (client: any) => client.from("parts").select("*");
     export function getMaterials(client: any) { return client.from("materials").select("*"); }
     export function getEmployees(client: any) { return client.from("employees").select("*"); }
     export function getInvitable(client: any) { return client.from("invitable").select("*"); }
     export function getUnbatchedOperations(client: any) { return client.from("jobOperation").select("*"); }
     export function getJobOperations(client: any, jobId: string) { return client.from("jobOperation").select("*").eq("jobId", jobId); }
     export async function getJobCosts(client: any) {
       await client.from("job").select("id");
       return client.rpc("job_costs");
     }`
  );
  project.createSourceFile(
    "/apps/erp/router.ts",
    `import * as service from "./app.service";
     import { getMaterials as materials } from "./app.service";
     declare function defineServiceFn(definition: any): any;
     const createIssue = defineServiceFn({ run: (ctx: any, input: any) => service.insertIssue(ctx.client, input) });
     const getIssueTypesList = defineServiceFn({ run: (ctx: any) => service.getIssueTypesList(ctx.client) });
     const getIssueTypes = defineServiceFn({ run: (ctx: any) => service.getIssueTypes(ctx.client) });
     const getTypesList = defineServiceFn({ run: (ctx: any) => service.getTypesList(ctx.client, "nonConformanceType") });
     const getParts = defineServiceFn({ run: (ctx: any) => service.getParts(ctx.client) });
     const getMaterials = defineServiceFn({ run: (ctx: any) => materials(ctx.client) });
     const getEmployees = defineServiceFn({ run: (ctx: any) => service.getEmployees(ctx.client) });
     const getInvitable = defineServiceFn({ run: (ctx: any) => service.getInvitable(ctx.client) });
     const getUnbatchedOperations = defineServiceFn({ run: (ctx: any) => service.getUnbatchedOperations(ctx.client) });
     const getJobOperations = defineServiceFn({ run: (ctx: any, input: any) => service.getJobOperations(ctx.client, input.jobId) });
     const getJobCosts = defineServiceFn({ run: (ctx: any) => service.getJobCosts(ctx.client) });
     export const router = {
       quality: { createIssue, getIssueTypesList, getIssueTypes, getTypesList },
       items: { getParts, getMaterials },
       users: { getEmployees, getInvitable },
       production: { getUnbatchedOperations, getJobOperations, getJobCosts }
     };`
  );
  const leaves = routerLeaves(project, "/apps/erp/router.ts");

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
    responseSchema: rows,
    serviceFn: { path: name.split("_") },
    ...rest
  });
  const idField = { type: "string" };
  const tools = [
    tool("quality_createIssue", {
      classification: "WRITE",
      responseSchema: undefined,
      schema: {
        type: "object",
        properties: {
          nonConformanceTypeId: idField,
          itemId: idField,
          employeeId: idField,
          jobOperationId: idField,
          jobId: idField,
          lineId: idField,
          openDate: idField
        }
      }
    }),
    tool("quality_getIssueTypesList", {}),
    tool("quality_getIssueTypes", { paginates: true }),
    tool("quality_getTypesList", {}),
    tool("items_getParts", { paginates: true }),
    tool("items_getMaterials", { paginates: true }),
    tool("users_getEmployees", { paginates: true }),
    tool("users_getInvitable", { paginates: true }),
    tool("production_getUnbatchedOperations", {}),
    tool("production_getJobOperations", {
      schema: {
        type: "object",
        properties: { jobId: idField },
        required: ["jobId"]
      }
    }),
    tool("production_getJobCosts", { paginates: true })
  ];

  const resolved = resolveIdLookups({
    tools,
    leaves,
    tables: TABLES,
    viewBases: new Map([
      ["parts", base("item", [["type", "Part"]])],
      ["materials", base("item", [["type", "Material"]])],
      ["employees", base("employee")],
      ["invitable", base("employee", [["status", "Invited"]])]
    ]),
    foreignKeys: new Map([
      [
        "nonConformance",
        new Map([
          ["nonConformanceTypeId", new Set(["nonConformanceType"])],
          ["itemId", new Set(["item"])],
          ["employeeId", new Set(["employee"])],
          ["jobOperationId", new Set(["jobOperation"])],
          ["jobId", new Set(["job"])]
        ])
      ],
      ["jobOperation", new Map([["jobId", new Set(["job"])]])]
    ])
  });
  const createIssue = resolved.get("quality_createIssue");

  it("links an id to the list of its table, preferring the `…List`", () => {
    expect(createIssue?.get("nonConformanceTypeId")).toEqual([
      "quality_getIssueTypesList"
    ]);
  });

  it("names every list when they slice the table on one column", () => {
    expect(createIssue?.get("itemId")?.sort()).toEqual([
      "items_getMaterials",
      "items_getParts"
    ]);
  });

  it("names only the full list when another view is a subset of it", () => {
    expect(createIssue?.get("employeeId")).toEqual(["users_getEmployees"]);
  });

  it("prefers a list scoped by its parent over a special-purpose one", () => {
    expect(createIssue?.get("jobOperationId")).toEqual([
      "production_getJobOperations"
    ]);
  });

  it("links nothing to a list that names a relation only at runtime", () => {
    // `quality_getTypesList` would outrank the …List below on its shorter name.
    expect(createIssue?.get("nonConformanceTypeId")).not.toContain(
      "quality_getTypesList"
    );
  });

  it("links nothing to a list that also reads through an RPC", () => {
    expect(createIssue?.has("jobId")).toBe(false);
  });

  it("links nothing it cannot place", () => {
    expect(createIssue?.has("lineId")).toBe(false);
    expect(createIssue?.has("openDate")).toBe(false);
  });
});

describe("lookupSentence", () => {
  it("names every lookup, which the docs link by name", () => {
    const sentence = lookupSentence([
      "items_getParts",
      "items_getTools",
      "items_getMaterials"
    ]);
    for (const name of [
      "items_getParts",
      "items_getTools",
      "items_getMaterials"
    ]) {
      expect(sentence).toContain(name);
    }
  });
});
