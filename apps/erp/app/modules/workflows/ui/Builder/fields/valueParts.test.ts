import type { ValueOrRef } from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import { encodeTokenId } from "./tokenId";
import { fromEditorParts, toEditorParts } from "./valueParts";

const names: Record<string, string> = { n1: "when-order-created" };
const nodeName = (id: string) => names[id];

const ref = {
  kind: "ref" as const,
  nodeId: "n1",
  output: "record",
  path: ["customer"]
};

const COLLAPSE = { collapseSingleRef: true };

describe("fromEditorParts", () => {
  it("keeps plain text a literal rather than a template", () => {
    expect(
      fromEditorParts([{ kind: "text", text: "hello" }], COLLAPSE)
    ).toEqual({
      kind: "literal",
      type: { kind: "primitive", of: "string" },
      value: "hello"
    });
  });

  it("keeps a lone variable a bare ref rather than a template", () => {
    expect(
      fromEditorParts(
        [{ kind: "token", id: encodeTokenId(ref), label: "anything" }],
        COLLAPSE
      )
    ).toEqual(ref);
  });

  it("becomes a template only when text and variables are mixed", () => {
    const value = fromEditorParts(
      [
        { kind: "text", text: "Hi " },
        { kind: "token", id: encodeTokenId(ref), label: "anything" }
      ],
      COLLAPSE
    );
    expect(value).toEqual({
      kind: "template",
      parts: [{ kind: "text", text: "Hi " }, ref]
    });
  });

  it("is undefined when the field is empty", () => {
    expect(fromEditorParts([], COLLAPSE)).toBeUndefined();
    expect(
      fromEditorParts([{ kind: "text", text: "" }], COLLAPSE)
    ).toBeUndefined();
  });

  it("drops a token it cannot decode instead of writing junk", () => {
    expect(
      fromEditorParts([{ kind: "token", id: "garbage", label: "x" }], COLLAPSE)
    ).toBeUndefined();
  });
});

describe("round trip", () => {
  const cases: ValueOrRef[] = [
    { kind: "literal", type: { kind: "primitive", of: "string" }, value: "hi" },
    ref,
    { kind: "item", path: [] },
    { kind: "template", parts: [{ kind: "text", text: "Hi " }, ref] }
  ];

  for (const value of cases) {
    it(`survives editor conversion: ${value.kind}`, () => {
      expect(fromEditorParts(toEditorParts(value, nodeName), COLLAPSE)).toEqual(
        value
      );
    });
  }

  it("shows the node name but stores the node id", () => {
    const [part] = toEditorParts(ref, nodeName);
    if (part.kind !== "token") throw new Error("expected a token");
    expect(part.label).toContain("when-order-created");
    expect(part.label).not.toContain("n1");
    expect(fromEditorParts([part], COLLAPSE)).toEqual(ref);
  });

  it("survives a rename, because only the label moves", () => {
    const before = toEditorParts(ref, nodeName);
    const after = toEditorParts(ref, () => "renamed-step");
    expect(fromEditorParts(after, COLLAPSE)).toEqual(
      fromEditorParts(before, COLLAPSE)
    );
  });
});

describe("template fields", () => {
  it("keeps a lone variable a template, because a bare ref is type-checked", () => {
    // `notify.message` takes text but accepts a variable of any type; storing a
    // bare ref there would fail the type check the template form is exempt from.
    const value = fromEditorParts(
      [{ kind: "token", id: encodeTokenId(ref), label: "anything" }],
      { collapseSingleRef: false }
    );
    expect(value).toEqual({ kind: "template", parts: [ref] });
  });
});
