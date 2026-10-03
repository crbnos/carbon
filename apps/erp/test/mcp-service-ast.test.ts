// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { sqlFunctionEffects } from "../../../packages/database/src/sql-effects";
import { resultShapeOf } from "../../../scripts/lib/result-shape";
import {
  auditParams,
  branchesOnKeyPresence,
  dbWrites,
  namedTables,
  paginates,
  parseServiceSource,
  rpcCalls
} from "../../../scripts/lib/service-ast";
import {
  assertReadCallsOnlyReads,
  contextParamsOf,
  declarationOf,
  describeUntypedArguments,
  upsertRule,
  withoutAbsentAuditColumns,
  withPayloadCompanyGroup
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

describe("positional params the dispatcher fills", () => {
  const fns = parse(`
    export async function updateStatus(
      client: Client, id: string, status: string, updatedBy: string
    ) {
      return client.from("job").update({ status, updatedBy }).eq("id", id);
    }
    export async function approve(client: Client, id: string, approver: string) {
      return client
        .from("job")
        .update({ status: "Approved", "updatedBy": approver as string })
        .eq("id", id);
    }
    export async function addSuppliers(
      client: Client, rfqId: string, supplierIds: string[],
      companyId: string, createdBy: string
    ) {
      return client.from("rfqSupplier").insert(
        supplierIds.map((supplierId) => ({ rfqId, supplierId, companyId, createdBy }))
      );
    }
    export async function reorder(
      db: Db, companyId: string, userId: string, updates: { id: string }[]
    ) {
      return db.updateTable("line").set({ updatedBy: userId }).execute();
    }
    export async function upsertRow(
      client: Client, row: { id: string; updatedBy: string }
    ) {
      return client.from("job").update({ ...row }).eq("id", row.id);
    }
    export async function shadowed(client: Client, updatedBy: string) {
      return [1].map((updatedBy) => ({ updatedBy }));
    }
    export async function viaRpc(client: Client, id: string, updatedBy: string) {
      return client.rpc("touch", { p_id: id, p_user: updatedBy });
    }
  `);

  it("reads the acting user off the audit column a param is written to", () => {
    expect(auditParams(fns.updateStatus.node)).toEqual(["updatedBy"]);
    expect(auditParams(fns.addSuppliers.node)).toEqual(["createdBy"]);
    // Whatever the param is called, and through a cast and a quoted key.
    expect(auditParams(fns.approve.node)).toEqual(["approver"]);
    // A field of a payload object is not a positional param.
    expect(auditParams(fns.upsertRow.node)).toEqual([]);
  });

  it("maps each filled param to its context value and leaves the payload out", () => {
    expect(contextParamsOf(fns.updateStatus)).toEqual({
      client: "client",
      updatedBy: "userId"
    });
    expect(contextParamsOf(fns.approve)).toEqual({
      client: "client",
      approver: "userId"
    });
    expect(contextParamsOf(fns.addSuppliers)).toEqual({
      client: "client",
      companyId: "companyId",
      createdBy: "userId"
    });
    expect(contextParamsOf(fns.reorder)).toEqual({
      db: "db",
      companyId: "companyId",
      userId: "userId"
    });
    expect(contextParamsOf(fns.upsertRow)).toEqual({ client: "client" });
  });

  it("refuses a positional audit param it cannot see written to the column", () => {
    // Passed on to something else: the body never names the column.
    expect(() => contextParamsOf(fns.viaRpc)).toThrow(/positional `updatedBy`/);
    // An inner binding of the same name is not the function's own parameter.
    expect(() => contextParamsOf(fns.shadowed)).toThrow(/positional `updatedBy`/);
  });
});

describe("how a service reports failure in its result", () => {
  const fns = parse(`
    type Failure = { message: string };
    type Row = { id: string };
    export async function read(): Promise<{ data: Row | null; error: Failure | null }> {
      return { data: null, error: null };
    }
    export async function bareError(): Promise<{ error: Failure | null }> {
      return { error: null };
    }
    export async function errorOnOnePath(): Promise<Row | { error: string }> {
      return { id: "a" };
    }
    export async function manyWrites() {
      const one: { data: null; error: Failure | null } = { data: null, error: null };
      return Promise.all([one, one]);
    }
    export async function flagged(): Promise<
      { ok: true; created: number } | { ok: false; reason: string }
    > {
      return { ok: true, created: 1 };
    }
    export async function rows(): Promise<Row[]> {
      return [];
    }
    export async function nothing(): Promise<void> {}
    export async function mixedList(): Promise<Array<Row | { error: Failure }>> {
      return [];
    }
    export async function twoSignals(): Promise<
      { error: Failure | null } | { success: boolean }
    > {
      return { success: true };
    }
  `);
  const shape = (name: string) =>
    resultShapeOf(
      fns[name].node.getProject().getTypeChecker().compilerObject,
      fns[name]
    );

  it("reads the shape off the awaited return type", () => {
    expect(shape("read")).toBe("envelope");
    // No \`data\`: the result dispatch used to hand back as a success.
    expect(shape("bareError")).toBe("envelope");
    expect(shape("errorOnOnePath")).toBe("envelope");
    expect(shape("manyWrites")).toBe("envelopes");
    expect(shape("flagged")).toBe("flag");
    expect(shape("rows")).toBe("plain");
    expect(shape("nothing")).toBe("plain");
  });

  it("refuses a result dispatch could not read one way", () => {
    expect(() => shape("mixedList")).toThrow(/list whose items/);
    expect(() => shape("twoSignals")).toThrow(/cannot tell which reports failure/);
  });
});

describe("a read tool and the SQL functions it calls", () => {
  const fns = parse(`
    export async function getDetails(client: Client, id: string) {
      return client.rpc("get_details", { item_id: id });
    }
    export async function getCast(client: Client, id: string) {
      return client.rpc("get_details" as unknown as "other", { item_id: id });
    }
    export async function getNextNumber(client: Client, table: string) {
      return client.rpc("take_number", { sequence_name: table });
    }
    export async function getUsage(client: Client) {
      return client.rpc("usage_by_table");
    }
    export async function getAnything(client: Client, name: string) {
      return client.rpc(name);
    }
    export async function getRows(client: Client) {
      return client.from("job").select("*");
    }
  `);

  const effects = sqlFunctionEffects([
    {
      name: "functions.sql",
      sql: `
        CREATE FUNCTION get_details(item_id text) RETURNS text LANGUAGE sql AS $$
          SELECT name FROM item WHERE id = item_id;
        $$;
        CREATE FUNCTION take_number(sequence_name text) RETURNS int LANGUAGE sql AS $$
          UPDATE sequence SET next = next + 1 WHERE "table" = sequence_name RETURNING next;
        $$;
        CREATE FUNCTION usage_by_table() RETURNS void LANGUAGE plpgsql AS $$
        BEGIN
          EXECUTE format('SELECT count(*) FROM %I', 'job');
        END $$;`
    }
  ]);

  it("reads the function name, through a cast, and reports one it cannot read", () => {
    expect(rpcCalls(fns.getDetails.node)).toEqual(["get_details"]);
    expect(rpcCalls(fns.getCast.node)).toEqual(["get_details"]);
    expect(rpcCalls(fns.getAnything.node)).toEqual([null]);
    expect(rpcCalls(fns.getRows.node)).toEqual([]);
  });

  it("lets a read call functions that only read", async () => {
    const sql = await effects;
    expect(() => assertReadCallsOnlyReads(fns.getDetails, sql)).not.toThrow();
    expect(() => assertReadCallsOnlyReads(fns.getRows, sql)).not.toThrow();
  });

  it("refuses a read that writes through a function, or that cannot be told", async () => {
    const sql = await effects;
    // settings_getNextSequence, in miniature.
    expect(() => assertReadCallsOnlyReads(fns.getNextNumber, sql)).toThrow(
      /calls the SQL function take_number, which writes \(public\.take_number: UPDATE sequence\)/
    );
    expect(() => assertReadCallsOnlyReads(fns.getUsage, sql)).toThrow(
      /cannot be told: public\.usage_by_table has dynamic SQL/
    );
    expect(() => assertReadCallsOnlyReads(fns.getAnything, sql)).toThrow(
      /not a string literal/
    );
  });
});

describe("a payload that declares companyGroupId", () => {
  const fns = parse(`
    type Report = { companyId: string; companyGroupId: string; key: string };
    export async function getPivot(client: Client, args: Report) {}
    export async function getRows(client: Client, args: { companyId: string }) {}
    export async function getBalances(client: Client, companyGroupId: string) {}
    export async function upsertOrder(
      client: Client,
      order:
        | { companyGroupId: string; createdBy: string }
        | { id: string; companyGroupId?: string; updatedBy: string }
    ) {}
    export async function upsertAccount(
      client: Client,
      account:
        | { companyGroupId: string; createdBy: string }
        | { id: string; updatedBy: string }
    ) {}
  `);

  it("is filled from the session, whether the type is inline or named", () => {
    // accounting_getDimensionPivot: the SQL function was called with no group.
    expect(withPayloadCompanyGroup(["companyId"], fns.getPivot)).toEqual([
      "companyId",
      "companyGroupId"
    ]);
    expect(withPayloadCompanyGroup(["companyId"], fns.upsertOrder)).toEqual([
      "companyId",
      "companyGroupId"
    ]);
  });

  it("is left alone when no payload declares it", () => {
    expect(withPayloadCompanyGroup(["companyId"], fns.getRows)).toEqual([
      "companyId"
    ]);
    // A positional companyGroupId is a context param, not a payload field.
    expect(withPayloadCompanyGroup(["companyId"], fns.getBalances)).toEqual([
      "companyId"
    ]);
  });

  it("refuses a union where only some shapes declare it", () => {
    // upsertPurchaseOrder: the update spread it into a table with no such column.
    expect(() => withPayloadCompanyGroup(["companyId"], fns.upsertAccount)).toThrow(
      /upsertAccount: only some shapes of `account` declare companyGroupId/
    );
  });
});

describe("an argument the schema left blank", () => {
  const fns = parse(`
    const statuses = ["Open", "Closed"] as const;
    type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
    type Row = { id: string; quoteLineId: string | null; notes: Json };
    export async function getTemplate(client: Client, kind: "quote" | "invoice", companyId: string) {}
    export async function getRisks(
      client: Client,
      args: { status?: typeof statuses; bucketDays?: [number, number]; search: string }
    ) {}
    export async function getDocuments(client: Client, job: Pick<Row, "id" | "quoteLineId">, itemId: string) {}
    export async function upsertThing(
      client: Client,
      thing: { name: string; customFields?: Json; payload: unknown; extra: any }
    ) {}
  `);
  const context = { client: "client", companyId: "companyId" };

  it("is described from the parameter's type", () => {
    // settings_getDocumentTemplate: the caller could only guess at documentType.
    const template = { type: "object", properties: { kind: {} } };
    describeUntypedArguments(template, fns.getTemplate, context);
    expect(template.properties.kind).toEqual({
      type: "string",
      enum: ["quote", "invoice"]
    });

    // A named row narrowed to what the function reads, among other params.
    const documents = {
      type: "object",
      properties: { job: {}, itemId: { type: "string" } }
    };
    describeUntypedArguments(documents, fns.getDocuments, context);
    expect(documents.properties).toEqual({
      job: {
        type: "object",
        properties: {
          id: { type: "string" },
          quoteLineId: { type: ["string", "null"] }
        },
        required: ["id", "quoteLineId"]
      },
      itemId: { type: "string" }
    });
  });

  it("reaches a blank field of a flat payload, and reads a tuple as a list", () => {
    const risks = {
      type: "object",
      properties: {
        status: { description: "Filter." },
        bucketDays: {},
        search: { type: "string" }
      }
    };
    describeUntypedArguments(risks, fns.getRisks, context);
    expect(risks.properties).toEqual({
      // quality_getRisks: an \`as const\` list came out as a map of statuses.
      status: {
        type: ["array", "null"],
        items: { type: "string", enum: ["Open", "Closed"] },
        description: "Filter."
      },
      bucketDays: { type: ["array", "null"], items: { type: "number" } },
      search: { type: "string" }
    });
  });

  it("stays blank where the type really is anything", () => {
    const thing = {
      type: "object",
      properties: {
        name: { type: "string" },
        customFields: {},
        payload: {},
        extra: {}
      }
    };
    describeUntypedArguments(thing, fns.upsertThing, context);
    expect(thing.properties).toEqual({
      name: { type: "string" },
      customFields: {},
      payload: {},
      extra: {}
    });
  });
});
