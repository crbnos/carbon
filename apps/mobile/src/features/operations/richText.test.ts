// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { isRichTextEmpty, richTextToPlain } from "./richText";

/**
 * These are work INSTRUCTIONS — the text for the part in the operator's hands
 * — so the failure that matters is not a wrong bullet character. It is text
 * that silently disappears. Every case below is one where a naive flattener
 * returns "" or throws, and the operator is left with a blank step.
 */

describe("richTextToPlain", () => {
  it("keeps every paragraph on its own line", () => {
    expect(
      richTextToPlain({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Torque to" }] },
          { type: "paragraph", content: [{ type: "text", text: "40 Nm" }] }
        ]
      })
    ).toBe("Torque to\n40 Nm");
  });

  it("joins inline marks into one line instead of splitting mid-sentence", () => {
    // Bold, italic and link text are separate text nodes in one paragraph.
    // Treating each as a block would break "torque to 40 Nm exactly" across
    // four lines, which reads as four instructions.
    expect(
      richTextToPlain({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Torque to " },
              { type: "text", text: "40 Nm", marks: [{ type: "bold" }] },
              { type: "text", text: " exactly" }
            ]
          }
        ]
      })
    ).toBe("Torque to 40 Nm exactly");
  });

  it("marks list items so a sequence still reads as a sequence", () => {
    expect(
      richTextToPlain({
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Clean the face" }]
                  }
                ]
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Fit the gasket" }]
                  }
                ]
              }
            ]
          }
        ]
      })
    ).toBe("• Clean the face\n• Fit the gasket");
  });

  it("keeps a heading as its own line", () => {
    expect(
      richTextToPlain({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Safety" }]
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Wear gloves" }]
          }
        ]
      })
    ).toBe("Safety\nWear gloves");
  });

  it("returns a plain string unchanged", () => {
    // Some rows carry a string where others carry a document.
    expect(richTextToPlain("  Deburr the edge  ")).toBe("Deburr the edge");
  });

  it("is empty for every shape that carries no text", () => {
    expect(richTextToPlain(null)).toBe("");
    expect(richTextToPlain(undefined)).toBe("");
    expect(richTextToPlain({})).toBe("");
    expect(richTextToPlain({ type: "doc", content: [] })).toBe("");
    // An empty paragraph is what the ERP editor leaves behind when someone
    // opens a step's description and saves without typing.
    expect(
      richTextToPlain({ type: "doc", content: [{ type: "paragraph" }] })
    ).toBe("");
    // A bullet with nothing in it is not content either.
    expect(
      richTextToPlain({
        type: "doc",
        content: [{ type: "bulletList", content: [{ type: "listItem" }] }]
      })
    ).toBe("");
  });

  it("recovers the text from a shape it does not recognise", () => {
    // The point of being tolerant: an unknown node type still yields its
    // words rather than an empty step.
    expect(
      richTextToPlain({
        type: "doc",
        content: [
          {
            type: "someFutureBlock",
            content: [{ type: "text", text: "Check the seal" }]
          }
        ]
      })
    ).toBe("Check the seal");
  });

  it("does not recurse forever on a cyclic document", () => {
    // Not a hypothetical: `description` is Json, so a hand-edited or
    // round-tripped row can be any shape at all, and a stack overflow here
    // would take down the whole Instructions tab.
    const node: Record<string, unknown> = {
      type: "paragraph",
      content: [{ type: "text", text: "x" }]
    };
    node.content = [node, { type: "text", text: "x" }];
    expect(() =>
      richTextToPlain({ type: "doc", content: [node] })
    ).not.toThrow();
  });

  it("does not throw on primitives in the content array", () => {
    expect(
      richTextToPlain({ type: "doc", content: [1, "two", null, true] })
    ).toBe("");
  });
});

describe("isRichTextEmpty", () => {
  it("distinguishes no instructions from blank-looking ones", () => {
    expect(isRichTextEmpty(null)).toBe(true);
    expect(
      isRichTextEmpty({ type: "doc", content: [{ type: "paragraph" }] })
    ).toBe(true);
    expect(
      isRichTextEmpty({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Go" }] }
        ]
      })
    ).toBe(false);
  });
});
