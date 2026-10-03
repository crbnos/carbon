// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { paramFilters, parseServiceSource } from "../../../scripts/lib/service-ast";
import { consensusByName, planInputs } from "./sweep/inputs";

function filtersOf(source: string) {
  return Object.fromEntries(
    parseServiceSource("mod", source).map((fn) => [fn.name, paramFilters(fn.node)])
  );
}

describe("what a parameter is, read off the body", () => {
  const filters = filtersOf(`
    export async function getJob(client: Client, jobId: string) {
      return client.from("job").select("*").eq("id", jobId).single();
    }
    export async function getLines(client: Client, args: { orderId: string; status: string }) {
      const { orderId } = args;
      return client.from("orderLine").select("*").eq("orderId", orderId).eq("status", args.status);
    }
    export async function getMany(client: Client, { ids }: { ids: string[] }) {
      const query = client.from("item").select("*");
      return query.in("id", ids);
    }
    export async function getPeriod(client: Client, date: string) {
      return client.from("period").select("*").lte("startDate", date).gte("endDate", date);
    }
    export async function viaRpc(client: Client, itemId: string) {
      return client.rpc("details", { item_id: itemId });
    }
    export async function notMine(client: Client, id: string) {
      const other = "x";
      return client.from("job").select("*").eq("id", other);
    }
  `);

  it("ties a parameter to the column it is compared with", () => {
    expect(filters.getJob).toEqual([{ path: "jobId", table: "job", column: "id" }]);
    // Reported outermost call first; the order carries no meaning.
    expect(filters.getLines).toHaveLength(2);
    expect(filters.getLines).toContainEqual({
      path: "args.orderId",
      table: "orderLine",
      column: "orderId"
    });
    expect(filters.getLines).toContainEqual({
      path: "args.status",
      table: "orderLine",
      column: "status"
    });
    expect(filters.getMany).toEqual([
      { path: "destructured.ids", table: "item", column: "id" }
    ]);
  });

  it("counts a range test: the column holds values the parameter is comparable with", () => {
    expect(filters.getPeriod).toContainEqual({
      path: "date",
      table: "period",
      column: "startDate"
    });
  });

  it("says nothing when the body does not compare it to a column", () => {
    expect(filters.viaRpc).toEqual([]);
    expect(filters.notMine).toEqual([]);
  });
});

describe("planning a tool's arguments", () => {
  const today = "2026-01-15";
  const knowledge = {
    consensus: consensusByName([
      { path: "itemId", table: "item", column: "id" },
      { path: "args.itemId", table: "itemCost", column: "itemId" },
      { path: "itemId", table: "itemCost", column: "itemId" },
      { path: "code", table: "currency", column: "code" },
      { path: "code", table: "uom", column: "code" }
    ]),
    tables: new Map([
      ["shipment", new Set(["id", "companyId"])],
      ["shipmentLine", new Set(["id", "shipmentId"])],
      ["receiptLine", new Set(["id", "locationId"])]
    ])
  };

  it("samples what the body compares the argument to, before anything else", () => {
    const plan = planInputs(
      { properties: { jobId: { type: "string" } }, required: ["jobId"] },
      [
        { path: "jobId", table: "jobMaterial", column: "jobId" },
        { path: "jobId", table: "job", column: "id" }
      ],
      knowledge,
      today
    );
    expect(plan).toEqual({
      args: {
        jobId: {
          kind: "sample",
          from: [{ table: "job", column: "id" }],
          many: false,
          source: "column"
        }
      },
      missing: []
    });
  });

  it("reads a name as the one table whose id it is compared to, however rarely", () => {
    // Compared to itemCost.itemId twice and item.id once: it is still an item's id.
    expect(knowledge.consensus.get("itemId")).toEqual({
      table: "item",
      column: "id"
    });
    // Two different tables, equally often, neither an id: no answer.
    expect(knowledge.consensus.has("code")).toBe(false);
  });

  it("falls back to the name: other services first, then the database", () => {
    const plan = planInputs(
      {
        properties: {
          itemId: { type: "string" },
          shipmentId: { type: "string" },
          locationId: { type: "string" }
        },
        required: ["itemId", "shipmentId", "locationId"]
      },
      [],
      knowledge,
      today
    );
    expect(plan.missing).toEqual([]);
    expect(plan.args.itemId).toMatchObject({
      from: [{ table: "item", column: "id" }],
      source: "name"
    });
    // A table named for it, then every table with a column of that name.
    expect(plan.args.shipmentId).toMatchObject({
      from: [
        { table: "shipment", column: "id" },
        { table: "shipmentLine", column: "shipmentId" }
      ],
      source: "name"
    });
    expect(plan.args.locationId).toMatchObject({
      from: [{ table: "receiptLine", column: "locationId" }],
      source: "name"
    });
  });

  it("leaves out what nothing answers, by its path", () => {
    const plan = planInputs(
      {
        properties: {
          code: { type: "string" },
          args: {
            type: "object",
            properties: { report: { type: "string" }, active: { type: "boolean" } },
            required: ["report", "active"]
          }
        },
        required: ["code", "args"]
      },
      [],
      knowledge,
      today
    );
    expect(plan.missing).toEqual(["code", "args.report"]);
  });

  it("plans the required fields of a nested object", () => {
    const plan = planInputs(
      {
        properties: {
          args: {
            type: "object",
            properties: { active: { type: "boolean" }, search: { type: "string" } },
            required: ["active"]
          }
        },
        required: ["args"]
      },
      [{ path: "args.active", table: "documents", column: "active" }],
      knowledge,
      today
    );
    expect(plan).toEqual({
      args: {
        args: {
          kind: "object",
          fields: {
            active: {
              kind: "sample",
              from: [{ table: "documents", column: "active" }],
              many: false,
              source: "column"
            }
          }
        }
      },
      missing: []
    });
  });

  it("does not sample from a filter that is not a plain column", () => {
    const plan = planInputs(
      { properties: { kind: { type: "string" } }, required: ["kind"] },
      [
        { path: "kind", table: "job", column: "attributes->>kind" },
        { path: "kind", table: "job", column: "process.name" }
      ],
      knowledge,
      today
    );
    expect(plan).toEqual({ args: {}, missing: ["kind"] });
  });

  it("fills simple types, and bounds a list read from its first page", () => {
    const plan = planInputs(
      {
        properties: {
          status: { type: "string", enum: ["Draft", "Posted"] },
          includeInactive: { type: "boolean" },
          asOfDate: { type: "string" },
          search: { type: "string" },
          offset: { type: "integer" },
          limit: { type: "number" }
        },
        required: ["status", "includeInactive", "asOfDate", "search", "offset"]
      },
      [],
      knowledge,
      today
    );
    expect(plan.missing).toEqual([]);
    expect(plan.args).toEqual({
      status: { kind: "value", value: "Draft", source: "type" },
      includeInactive: { kind: "value", value: false, source: "type" },
      asOfDate: { kind: "value", value: today, source: "name" },
      search: { kind: "value", value: "", source: "name" },
      offset: { kind: "value", value: 0, source: "type" },
      limit: { kind: "value", value: 5, source: "type" }
    });
  });
});
