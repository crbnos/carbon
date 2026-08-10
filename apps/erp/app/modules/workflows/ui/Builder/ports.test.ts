import type { WorkflowNodeType } from "@carbon/workflows";
import { getNodeHandles, NODE_KINDS } from "@carbon/workflows";
import type { MessageDescriptor } from "@lingui/core";
import { describe, expect, it, vi } from "vitest";
import { createNode } from "./graph";
import { conditionPathLabel, portsFor } from "./ports";

// `msg` is a compile-time macro and plain vitest doesn't transform it, so the raw
// export throws on access. Stub it to the interpolated source string.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((out, part, i) => out + part + (values[i] ?? ""), "")
}));

/** Stand-in for `useLingui()`'s `t`: resolves a descriptor without a catalog. */
const t = (descriptor: MessageDescriptor): string =>
  typeof descriptor === "string"
    ? descriptor
    : (descriptor.message ?? descriptor.id);

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

  it("labels ports with the same words as the path pill", () => {
    const node = createNode("condition", { x: 0, y: 0 });
    if (node.type !== "condition") throw new Error("wrong kind");
    for (const port of portsFor(node, t)) {
      expect(port.label).toBe(conditionPathLabel(node.data.paths, port.id, t));
    }
    expect(portsFor(node, t).map((p) => p.label)).toEqual(["If", "Otherwise"]);
  });
});
