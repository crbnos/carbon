import type { WorkflowNodeType } from "@carbon/workflows";
import { getNodeHandles, NODE_KINDS } from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import { createNode } from "./graph";
import { conditionPathLabel, portsFor } from "./ports";

/** Stand-in for `useLingui()`'s `t`: interpolates without needing a catalog. */
const t = (strings: TemplateStringsArray, ...values: unknown[]): string =>
  strings.reduce((out, part, i) => out + part + (values[i] ?? ""), "");

describe("portsFor", () => {
  it("returns exactly the handles the validator knows about, for every kind", () => {
    for (const kind of Object.keys(NODE_KINDS) as WorkflowNodeType[]) {
      const node = createNode(kind, { x: 0, y: 0 });
      expect(
        portsFor(node, t).map((p) => p.id),
        `${kind} port ids drifted from getNodeHandles`
      ).toEqual(getNodeHandles(node));
    }
  });

  it("gives every port a non-empty label", () => {
    for (const kind of Object.keys(NODE_KINDS) as WorkflowNodeType[]) {
      const node = createNode(kind, { x: 0, y: 0 });
      for (const port of portsFor(node, t)) {
        expect(port.label, `${kind}/${port.id} has no label`).not.toBe("");
      }
    }
  });

  it("tones the success and failure handles, leaving the rest default", () => {
    const node = createNode("action", { x: 0, y: 0 });
    const tones = Object.fromEntries(
      portsFor(node, t).map((p) => [p.id, p.tone])
    );
    expect(tones).toEqual({ success: "success", failure: "failure" });
  });

  it("anchors condition paths inline and everything else on the card", () => {
    const condition = createNode("condition", { x: 0, y: 0 });
    for (const port of portsFor(condition, t)) {
      expect(port.anchor).toBe("inline");
    }
    const action = createNode("action", { x: 0, y: 0 });
    for (const port of portsFor(action, t)) {
      expect(port.anchor).toBe("card");
    }
  });
});

describe("conditionPathLabel", () => {
  it("labels the seeded if and else paths", () => {
    const node = createNode("condition", { x: 0, y: 0 });
    if (node.type !== "condition") throw new Error("wrong kind");
    const [ifPath, elsePath] = node.data.paths;
    expect(conditionPathLabel(node.data.paths, ifPath.id, t)).toBe("If");
    expect(conditionPathLabel(node.data.paths, elsePath.id, t)).toBe(
      "Otherwise"
    );
  });

  it("matches the port label for the same path", () => {
    const node = createNode("condition", { x: 0, y: 0 });
    if (node.type !== "condition") throw new Error("wrong kind");
    for (const port of portsFor(node, t)) {
      expect(port.label).toBe(conditionPathLabel(node.data.paths, port.id, t));
    }
  });
});
