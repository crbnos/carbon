// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { getNodeHandles } from "./nodes";
import {
  CURRENT_DEFINITION_FORMAT_VERSION,
  nodeSchema,
  workflowDefinitionSchema
} from "./schema";
import {
  itemRefSchema,
  scheduleSchema,
  valueTypeSchema,
  variableRefSchema
} from "./types";

const node = (
  type: string,
  data: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {}
) => ({
  id: "n1",
  name: `${type}_0`,
  type,
  position: { x: 0, y: 0 },
  data,
  ...overrides
});

describe("workflowDefinitionSchema", () => {
  it("stamps the current format version on a definition that has none", () => {
    const parsed = workflowDefinitionSchema.parse({
      nodes: [node("trigger")],
      edges: []
    });
    expect(parsed.formatVersion).toBe(CURRENT_DEFINITION_FORMAT_VERSION);
  });

  it("rejects an unknown node type", () => {
    expect(
      workflowDefinitionSchema.safeParse({
        nodes: [node("teleport")],
        edges: []
      }).success
    ).toBe(false);
  });
});

describe("nodeSchema", () => {
  it("defaults a trigger's events and origin", () => {
    const parsed = nodeSchema.parse(node("trigger"));
    if (parsed.type !== "trigger") throw new Error("expected a trigger node");
    expect(parsed.data).toMatchObject({ events: [], origin: "Both" });
  });

  // The data node was widened in place rather than renamed, so a filter node saved
  // before `operation` existed must still parse AND behave identically — that is
  // what lets this ship with no format bump and no migration.
  it("reads a filter node saved before the data operations existed", () => {
    const parsed = nodeSchema.parse({
      id: "n3",
      name: "filter_0",
      type: "filter",
      position: { x: 0, y: 0 },
      data: {
        source: { kind: "ref", nodeId: "t1", output: "record", path: [] },
        combinator: "or",
        clauses: []
      }
    });
    if (parsed.type !== "filter") throw new Error("expected a filter node");
    expect(parsed.data.operation).toBe("filter");
    // Off by default: a stored `flatten` on a non-pluck node would mean nothing.
    expect(parsed.data.flatten).toBe(false);
    expect(parsed.data.field).toBeUndefined();
    // Everything it DID carry survives untouched.
    expect(parsed.data.combinator).toBe("or");
    expect(parsed.data.source).toEqual({
      kind: "ref",
      nodeId: "t1",
      output: "record",
      path: []
    });
  });

  it("parses a filter node with no operations array as none stored", () => {
    const parsed = nodeSchema.parse({
      id: "n3",
      name: "filter_0",
      type: "filter",
      position: { x: 0, y: 0 },
      data: { combinator: "and", clauses: [], operation: "count" }
    });
    if (parsed.type !== "filter") throw new Error("expected a filter node");
    // `cardsOf` synthesizes the single card; the schema must not invent one.
    expect(parsed.data.operations).toBeUndefined();
  });

  it("applies per-card defaults inside a stored chain", () => {
    const parsed = nodeSchema.parse({
      id: "n3",
      name: "filter_0",
      type: "filter",
      position: { x: 0, y: 0 },
      data: {
        combinator: "and",
        clauses: [],
        operations: [
          { id: "card-0" },
          { id: "card-1", operation: "pluck", field: "status" }
        ]
      }
    });
    if (parsed.type !== "filter") throw new Error("expected a filter node");
    expect(parsed.data.operations).toEqual([
      {
        id: "card-0",
        operation: "filter",
        combinator: "and",
        clauses: [],
        flatten: false
      },
      {
        id: "card-1",
        operation: "pluck",
        combinator: "and",
        clauses: [],
        field: "status",
        flatten: false
      }
    ]);
  });

  it("refuses a chain whose cards share an id, or have none", () => {
    const filter = (operations: unknown[]) =>
      nodeSchema.safeParse({
        id: "n4",
        name: "filter_0",
        type: "filter",
        position: { x: 0, y: 0 },
        data: { combinator: "and", clauses: [], operations }
      }).success;
    expect(filter([{ id: "card-0" }, { id: "card-0" }])).toBe(false);
    expect(filter([{ id: "" }])).toBe(false);
    expect(filter([{ id: "card-0" }, { id: "card-1" }])).toBe(true);
  });

  it("reads an item ref with and without a card scope", () => {
    expect(
      itemRefSchema.parse({ kind: "item", path: [] }).card
    ).toBeUndefined();
    expect(
      itemRefSchema.parse({ kind: "item", path: ["id"], card: "card-1" }).card
    ).toBe("card-1");
  });

  it("refuses an operation the data node does not offer", () => {
    const parse = () =>
      nodeSchema.parse({
        id: "n4",
        name: "filter_1",
        type: "filter",
        position: { x: 0, y: 0 },
        data: { combinator: "and", clauses: [], operation: "sum" }
      });
    expect(parse).toThrow();
  });

  // Rows written when repeating was a stored flag still carry it; reading one
  // must drop it rather than fail, or those workflows become unopenable.
  it("drops the batch flag an older row still carries", () => {
    const parsed = nodeSchema.parse(
      node("action", { action: "notify", batch: true })
    );
    expect(parsed.data).toEqual({ action: "notify", inputs: {} });
  });

  it("rejects a name with uppercase letters", () => {
    expect(
      nodeSchema.safeParse(node("trigger", {}, { name: "CheckOrder" })).success
    ).toBe(false);
  });

  it("defaults a variable reference's property path to empty", () => {
    expect(
      variableRefSchema.parse({ kind: "ref", nodeId: "n1", output: "result" })
        .path
    ).toEqual([]);
  });
});

describe("getNodeHandles", () => {
  it.each([
    [
      "an action success and failure",
      node("action", { action: "notify" }),
      ["success", "failure"]
    ],
    [
      "a condition one handle per path",
      node("condition", {
        paths: [
          { id: "p1", kind: "if" },
          { id: "p2", kind: "else" }
        ]
      }),
      ["p1", "p2"]
    ],
    ["a trigger a single default handle", node("trigger"), ["out"]]
  ])("gives %s", (_, raw, handles) => {
    expect(getNodeHandles(nodeSchema.parse(raw))).toEqual(handles);
  });
});

describe("valueTypeSchema", () => {
  it("accepts a list of entities but not a list of lists", () => {
    const entity = { kind: "entity", of: "part" };
    expect(
      valueTypeSchema.safeParse({ kind: "list", of: entity }).success
    ).toBe(true);
    expect(
      valueTypeSchema.safeParse({
        kind: "list",
        of: { kind: "list", of: entity }
      }).success
    ).toBe(false);
  });
});

describe("scheduleSchema", () => {
  it("accepts the last day of the month", () => {
    const parsed = scheduleSchema.parse({
      freq: "Monthly",
      hour: 9,
      minute: 0,
      day: "last",
      tz: "America/Chicago"
    });
    expect(parsed.day).toBe("last");
  });
});
