// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  branchesOnKeyPresence,
  dbWrites,
  namedTables,
  paginates,
  parseServiceSource
} from "../../../scripts/lib/service-ast";
import {
  declarationOf,
  upsertRule,
  withoutAbsentAuditColumns
} from "../../../scripts/lib/service-metadata";

// The generator's questions about a service function, asked of real source
// through the real compiler — no fixtures on disk, nothing stubbed.
function parse(source: string) {
  return Object.fromEntries(
    parseServiceSource("mod", source).map((fn) => [fn.name, fn])
  );
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

// A tool is what its doc comment declares. The declaration is checked against
// the body in the one direction that can be checked.
describe("the @mcp declaration", () => {
  const fns = parse(`
    export async function untagged(client: any) {}

    /** @mcp read */
    export async function lookupPrice(client: any) {
      return client.from("price").select("*");
    }

    /**
     * Rewrites the prices for a line.
     * @mcp upsert destructive — replaces every row for the line
     */
    export async function upsertPrices(client: any) {
      await client.from("price").delete().eq("lineId", "x");
      return client.from("price").insert([]);
    }

    /** @mcp action */
    export async function lockPeriod(client: any) {
      return client.rpc("lock_period");
    }

    /** @mcp read */
    export async function getOrCreatePeriod(client: any) {
      return client.from("period").insert({});
    }

    /** @mcp upsert */
    export async function upsertSteps(client: any) {
      await client.from("step").delete().eq("id", "x");
    }

    /** @mcp fetch */
    export async function getThing(client: any) {}

    /**
     * @mcp update
     * @mcp delete
     */
    export async function twice(client: any) {}

    /**
     * @mcp update
     * @mcp audit createdBy
     * @mcp permission users:update
     */
    export async function withSettings(client: any) {}

    /** @mcp audit createdBy */
    export async function settingOnly(client: any) {}
  `);
  const declare = (name: string) => declarationOf(fns[name]!);

  it("is undefined without a tag — the function is simply not a tool", () => {
    expect(declare("untagged")).toBeUndefined();
  });

  it("reads the verb and the destructive modifier, whatever the function is called", () => {
    expect(declare("lookupPrice")).toEqual({ verb: "read", destructive: false });
    expect(declare("upsertPrices")).toEqual({
      verb: "upsert",
      destructive: true
    });
    expect(declare("lockPeriod")).toEqual({
      verb: "action",
      destructive: false
    });
  });

  it("refuses a read whose body writes", () => {
    expect(() => declare("getOrCreatePeriod")).toThrow(
      /declares `@mcp read` but its body writes to period/
    );
  });

  it("refuses a write whose body deletes rows without saying destructive", () => {
    expect(() => declare("upsertSteps")).toThrow(
      /Declare `@mcp upsert destructive`/
    );
  });

  it("tells a setting line from the verb line", () => {
    expect(declare("withSettings")).toEqual({
      verb: "update",
      destructive: false
    });
    expect(() => declare("settingOnly")).toThrow(/it has 0/);
  });

  it("refuses a verb outside the vocabulary, and two declarations", () => {
    expect(() => declare("getThing")).toThrow(/`@mcp fetch` is not a verb/);
    expect(() => declare("twice")).toThrow(
      /must declare exactly one `@mcp <verb>` line; it has 2/
    );
  });
});

// An upsert that branches on an audit field needs a rule for telling create
// from update, and the generator refuses to publish one without it. Table and
// column names are checked against the real generated database types.
describe("the upsert rule", () => {
  const fns = parse(`
    type Shape = { name: string };
    /** @mcp upsert */
    export async function byId(
      client: any,
      row: (Shape & { createdBy: string }) | (Shape & { id: string; updatedBy: string })
    ) {}

    /** @mcp upsert */
    export async function idOptionalOnCreate(
      client: any,
      row: { id?: string; name: string } & (
        | { createdBy: string }
        | { updatedBy: string }
      )
    ) {}

    /** @mcp upsert */
    export async function idBothWays(
      client: any,
      row:
        | (Shape & { id: string; createdBy: string })
        | (Shape & { id: string; updatedBy: string })
    ) {}

    /**
     * @mcp upsert
     * @mcp key pickMethod itemId, locationId
     */
    export async function composite(client: any, row: any) {}

    /**
     * @mcp upsert
     * @mcp key item id
     * @mcp key item readableId=id
     */
    export async function alternatives(client: any, row: any) {}

    /**
     * @mcp upsert
     * @mcp key notATable id
     */
    export async function unknownTable(client: any, row: any) {}

    /**
     * @mcp upsert
     * @mcp key pickMethod bogus
     */
    export async function unknownColumn(client: any, row: any) {}

    /**
     * @mcp upsert
     * @mcp key pickMethod itemId
     */
    export async function fieldNotInInput(client: any, row: any) {}
  `);
  const schema = (...fields: string[]) => ({
    type: "object",
    properties: Object.fromEntries(fields.map((f) => [f, { type: "string" }]))
  });

  it("reads `id decides` off the parameter type", () => {
    expect(upsertRule(fns.byId!, schema("id", "name"))).toEqual({
      keys: ["id"]
    });
  });

  // A create that MAY carry an id makes "an id was sent" ambiguous: it could be
  // a new record under a chosen id. Only a create shape with no id field at all
  // lets the id decide.
  it("does not let id decide when a create may carry one too", () => {
    expect(() =>
      upsertRule(fns.idOptionalOnCreate!, schema("id", "name"))
    ).toThrow(/cannot say whether it creates or updates/);
  });

  it("refuses an upsert whose payload cannot say, until a key is declared", () => {
    expect(() => upsertRule(fns.idBothWays!, schema("id", "name"))).toThrow(
      /cannot say whether it creates or updates.*`@mcp key <table>/s
    );
  });

  it("turns key lines into lookups, several lines being alternatives", () => {
    expect(upsertRule(fns.composite!, schema("itemId", "locationId"))).toEqual({
      keys: ["itemId", "locationId"],
      lookups: [
        {
          table: "pickMethod",
          match: { itemId: "itemId", locationId: "locationId" }
        }
      ]
    });
    expect(upsertRule(fns.alternatives!, schema("id"))).toEqual({
      keys: ["id"],
      lookups: [
        { table: "item", match: { id: "id" } },
        { table: "item", match: { readableId: "id" } }
      ]
    });
  });

  it("refuses a key that names nothing real", () => {
    expect(() => upsertRule(fns.unknownTable!, schema("id"))).toThrow(
      /"notATable", which is not a table or view/
    );
    expect(() => upsertRule(fns.unknownColumn!, schema("bogus"))).toThrow(
      /"pickMethod" has no "bogus" column/
    );
    expect(() => upsertRule(fns.fieldNotInInput!, schema("id"))).toThrow(
      /field "itemId" is not part of the tool's input/
    );
  });
});

// The bug this branch started from: createdBy stamped onto a payload that is
// spread into a table with no such column (PGRST204).
describe("audit fields the table does not have", () => {
  const fns = parse(`
    export async function linkTable(client: any, row: any) {
      return client.from("customerPartToItem").insert([row]);
    }
    export async function audited(client: any, row: any) {
      return client.from("customer").insert([row]);
    }
    export async function twoTables(client: any, row: any) {
      await client.from("item").select("id");
      return client.from("customerPartToItem").insert([row]);
    }
  `);
  const fields = ["companyId", "createdBy", "updatedBy"] as const;
  const drop = (name: string) =>
    withoutAbsentAuditColumns([...fields], fns[name]!);

  it("drops them when the function's one table lacks the columns", () => {
    expect(drop("linkTable")).toEqual(["companyId"]);
  });

  it("keeps them when the table has the columns, or the table is ambiguous", () => {
    expect(drop("audited")).toEqual([...fields]);
    expect(drop("twoTables")).toEqual([...fields]);
  });
});

