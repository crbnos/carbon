// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import {
  branchesOnKeyPresence,
  dbWrites,
  exportedFunctions,
  namedTables,
  paginates
} from "../../../scripts/lib/service-ast";

// The generator's questions about a service function, asked of real source
// through the real compiler — no fixtures on disk, nothing stubbed.
function parse(source: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const functions = exportedFunctions(
    "mod",
    project.createSourceFile("mod.service.ts", source)
  );
  return Object.fromEntries(functions.map((fn) => [fn.name, fn]));
}

describe("service discovery", () => {
  const fns = parse(`
    /** Stray block above the real one. @mcp */
    /**
     * Reads a thing.
     * @mcp read
     */
    export async function getThing(
      client: Client,
      /** Newest first. */
      sortDescending: boolean = false,
      page = 1,
      { a, b }: { a: string; /** inner */ b: number },
      opts?: { limit: number }
    ) {}

    export const listThings = async (client: Client, ...ids: string[]) => {};

    const notExported = () => {};
    export const NOT_A_FUNCTION = 3;
    function helper() {}
  `);

  it("collects exported declarations and arrow consts, nothing else", () => {
    expect(Object.keys(fns)).toEqual(["getThing", "listThings"]);
    expect(fns.getThing?.toolName).toBe("mod_getThing");
  });

  it("reads a typed default as its declared type, and optional", () => {
    expect(fns.getThing?.params[1]).toEqual({
      name: "sortDescending",
      typeStr: "boolean",
      optional: true,
      description: "Newest first.",
      rest: false
    });
    expect(fns.getThing?.params[2]).toMatchObject({
      name: "page",
      typeStr: "number",
      optional: true
    });
  });

  it("names a destructured param and keeps comments out of its type", () => {
    const param = fns.getThing?.params[3];
    expect(param?.name).toBe("destructured");
    expect(param?.typeStr).not.toContain("inner");
    expect(param?.typeStr).toContain("b: number");
    // The description is the PARAM's own doc, never a field's.
    expect(param?.description).toBeUndefined();
    expect(fns.getThing?.params[4]).toMatchObject({ optional: true });
  });

  it("flags a rest parameter", () => {
    expect(fns.listThings?.params.map((p) => p.rest)).toEqual([false, true]);
  });

  it("takes tags from the doc block attached to the declaration only", () => {
    expect(fns.getThing?.tags).toEqual([{ name: "mcp", comment: "read" }]);
    expect(fns.getThing?.jsdoc).toContain("Reads a thing.");
    expect(fns.listThings?.tags).toEqual([]);
  });
});

describe("what a body does", () => {
  const fns = parse(`
    export async function castChain(client: any) {
      return (client.from("accountingPeriod") as any).insert({ a: 1 });
    }
    export async function viaVariable(client: any) {
      const query = client.from("job");
      await query.delete().eq("id", "x");
    }
    export async function kysely(trx: any) {
      await trx.deleteFrom("jobMaterial").execute();
      await trx.insertInto("jobMaterial").values({}).execute();
    }
    export async function setDelete(client: any) {
      const members = new Set<string>();
      members.delete("x");
      const rows = await client.from("item").select("*").range(0, 9);
      return rows.data.toString();
    }
    export async function storageWrite(client: any) {
      await client.storage.from("private").update("path", "body");
    }
    export async function upsertBranch(client: any, row: any) {
      if ("createdBy" in row) return client.from("a").insert(row);
      return client.from("b").update(row);
    }
  `);
  const writes = (name: string) => dbWrites(fns[name]!.node);

  it("follows a query chain through casts and a local variable", () => {
    expect(writes("castChain")).toEqual([
      { kind: "insert", table: "accountingPeriod" }
    ]);
    expect(writes("viaVariable")).toEqual([{ kind: "delete", table: "job" }]);
  });

  it("sees the Kysely spellings", () => {
    expect(writes("kysely")).toEqual([
      { kind: "delete", table: "jobMaterial" },
      { kind: "insert", table: "jobMaterial" }
    ]);
  });

  it("does not mistake a Set, a prototype method or storage for a row write", () => {
    expect(writes("setDelete")).toEqual([]);
    expect(writes("storageWrite")).toEqual([]);
    expect(namedTables(fns.storageWrite!.node)).toEqual([]);
  });

  it("answers the pagination, table and discriminator questions", () => {
    expect(paginates(fns.setDelete!.node)).toBe(true);
    expect(paginates(fns.castChain!.node)).toBe(false);
    expect(namedTables(fns.upsertBranch!.node)).toEqual(["a", "b"]);
    expect(
      branchesOnKeyPresence(fns.upsertBranch!.node, ["createdBy", "updatedBy"])
    ).toBe(true);
    expect(
      branchesOnKeyPresence(fns.castChain!.node, ["createdBy", "updatedBy"])
    ).toBe(false);
  });
});
