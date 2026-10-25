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
import { scheduleSchema, valueTypeSchema, variableRefSchema } from "./types";

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
