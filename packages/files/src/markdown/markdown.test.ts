// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { TiptapText } from "./markdown";

describe("markdownToTiptap", () => {
  it("turns plain text into paragraphs, keeping single line breaks", () => {
    expect(
      TiptapText("First line\nSecond line\n\nNew paragraph").toDocument()
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
    const doc = TiptapText(
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
    ).toDocument();
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
    expect(TiptapText("<script>alert(1)</script>").toDocument()).toEqual({
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
    const doc = TiptapText("[x](javascript:alert(1))").toDocument();
    expect(JSON.stringify(doc)).not.toContain('"link"');
  });

  it("returns a loadable document for an empty string", () => {
    expect(TiptapText("").toDocument()).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }]
    });
  });
});

describe("TiptapText format: text", () => {
  it("makes each line a paragraph and **text** bold", () => {
    expect(
      TiptapText("Tap with **TiN-coated** tap.\n\nChase a ** b", {
        format: "text"
      }).toDocument()
    ).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Tap with " },
            { type: "text", text: "TiN-coated", marks: [{ type: "bold" }] },
            { type: "text", text: " tap." }
          ]
        },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "Chase a ** b" }] }
      ]
    });
  });

  it("splits on CRLF, LF and CR alike, and keeps asterisks inside bold", () => {
    for (const text of [
      "a\r\n**M6*1 tap**",
      "a\n**M6*1 tap**",
      "a\r**M6*1 tap**"
    ]) {
      expect(TiptapText(text, { format: "text" }).toDocument().content).toEqual(
        [
          { type: "paragraph", content: [{ type: "text", text: "a" }] },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "M6*1 tap", marks: [{ type: "bold" }] }
            ]
          }
        ]
      );
    }
  });
});

describe("TiptapText reads stored values", () => {
  const doc = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }]
  };

  it("passes a document through", () => {
    expect(TiptapText(doc).toDocument()).toBe(doc);
  });

  it("reads a document encoded as text", () => {
    expect(TiptapText(JSON.stringify(doc)).toDocument()).toEqual(doc);
  });

  it("reads JSON that is not an object as text", () => {
    expect(TiptapText("123").toString()).toBe("123");
  });

  it("reads JSON that is not a document as text", () => {
    expect(TiptapText('{"a":1}').toString()).toBe('{"a":1}');
  });

  it("reads `{}` as an empty document, stored or encoded", () => {
    expect(TiptapText({}).toString()).toBe("");
    expect(TiptapText("{}").toString()).toBe("");
  });

  it("reads null as an empty document", () => {
    expect(TiptapText(null).toDocument()).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }]
    });
  });
});

describe("TiptapText.toString", () => {
  it("joins blocks as lines and drops marks", () => {
    expect(
      TiptapText("# Title\n\n- **one**\n- two\n\n---\n\nend").toString()
    ).toBe("Title\none\ntwo\nend");
  });

  it("round-trips plain text read as typed", () => {
    const text = "1. Ship\n**not bold markers**";
    expect(TiptapText(text, { format: "text" }).toString()).toBe(
      "1. Ship\nnot bold markers"
    );
  });
});

describe("TiptapText.toMarkdown", () => {
  it("round-trips Markdown", () => {
    const markdown = [
      "## Setup",
      "",
      "Check **torque** and *finish*, see [spec](https://example.com).",
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
      "`inline` code"
    ].join("\n");
    expect(TiptapText(markdown).toMarkdown()).toBe(markdown);
  });

  it("writes editor-only nodes as text instead of throwing", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ask " },
            { type: "mention", attrs: { id: "u1", label: "Nick" } },
            {
              type: "text",
              text: " now",
              marks: [
                { type: "underline" },
                { type: "bold" },
                { type: "strike" }
              ]
            }
          ]
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Tack" }] }
              ]
            }
          ]
        }
      ]
    };
    expect(TiptapText(doc).toMarkdown()).toBe("Ask @Nick **~~now~~**\n\nTack");
  });

  it("is empty for an empty document", () => {
    expect(TiptapText({ type: "doc", content: [] }).toMarkdown()).toBe("");
    expect(TiptapText(null).toMarkdown()).toBe("");
  });
});
