// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { markdownToTiptap } from "./markdown";

describe("markdownToTiptap", () => {
  it("turns plain text into paragraphs, keeping single line breaks", () => {
    expect(
      markdownToTiptap("First line\nSecond line\n\nNew paragraph")
    ).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "First line" },
            { type: "hardBreak" },
            { type: "text", text: "Second line" }
          ]
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "New paragraph" }]
        }
      ]
    });
  });

  it("uses the editor's node and mark names", () => {
    const doc = markdownToTiptap(
      [
        "## Inspection",
        "",
        "Check **torque** and _finish_, see [spec](https://example.com).",
        "",
        "- one",
        "- two",
        "",
        "3. three",
        "",
        "> quoted",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "---",
        "",
        "`inline`"
      ].join("\n")
    );
    expect(doc.content?.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "bulletList",
      "orderedList",
      "blockquote",
      "codeBlock",
      "horizontalRule",
      "paragraph"
    ]);
    expect(doc.content?.[0]?.attrs).toEqual({ level: 2 });
    expect(doc.content?.[1]?.content).toEqual([
      { type: "text", text: "Check " },
      { type: "text", text: "torque", marks: [{ type: "bold" }] },
      { type: "text", text: " and " },
      { type: "text", text: "finish", marks: [{ type: "italic" }] },
      { type: "text", text: ", see " },
      {
        type: "text",
        text: "spec",
        marks: [
          { type: "link", attrs: { href: "https://example.com", title: null } }
        ]
      },
      { type: "text", text: "." }
    ]);
    expect(doc.content?.[2]?.content?.[0]?.type).toBe("listItem");
    expect(doc.content?.[3]?.attrs).toEqual({ start: 3 });
    expect(doc.content?.[5]).toEqual({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const x = 1;" }]
    });
    expect(doc.content?.[7]?.content?.[0]?.marks).toEqual([{ type: "code" }]);
  });

  it("keeps raw HTML as literal text", () => {
    expect(markdownToTiptap("<script>alert(1)</script>")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "<script>alert(1)</script>" }]
        }
      ]
    });
  });

  it("does not link a javascript: URL", () => {
    const doc = markdownToTiptap("[x](javascript:alert(1))");
    expect(JSON.stringify(doc)).not.toContain('"link"');
  });

  it("returns a loadable document for an empty string", () => {
    expect(markdownToTiptap("")).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }]
    });
  });
});
