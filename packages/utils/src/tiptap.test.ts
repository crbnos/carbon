// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  documentHasImages,
  richTextToPlainText,
  textToRichTextDoc
} from "./tiptap";

describe("documentHasImages", () => {
  it("returns false for empty / textless documents", () => {
    expect(documentHasImages(null)).toBe(false);
    expect(documentHasImages(undefined)).toBe(false);
    expect(documentHasImages({})).toBe(false);
    expect(documentHasImages({ type: "doc", content: [] })).toBe(false);
    expect(
      documentHasImages({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "hello" }] }
        ]
      })
    ).toBe(false);
  });

  it("detects a top-level image node (image-only description)", () => {
    expect(
      documentHasImages({
        type: "doc",
        content: [
          { type: "image", attrs: { src: "/file/preview/private/x.png" } }
        ]
      })
    ).toBe(true);
  });

  it("detects updatedImage and deeply nested images", () => {
    expect(
      documentHasImages({
        type: "doc",
        content: [{ type: "updatedImage", attrs: { src: "a.png" } }]
      })
    ).toBe(true);
    expect(
      documentHasImages({
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "image", attrs: { src: "b.png" } }]
              }
            ]
          }
        ]
      })
    ).toBe(true);
  });
});

describe("textToRichTextDoc", () => {
  it("is null for blank text", () => {
    expect(textToRichTextDoc(null)).toBeNull();
    expect(textToRichTextDoc(undefined)).toBeNull();
    expect(textToRichTextDoc("")).toBeNull();
    expect(textToRichTextDoc("  \n\t ")).toBeNull();
  });

  it("wraps one line in one paragraph — the editor's own shape", () => {
    expect(textToRichTextDoc("Axis 4 faults on a cold start.")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Axis 4 faults on a cold start." }]
        }
      ]
    });
  });

  it("makes a paragraph per line and an empty paragraph per blank line", () => {
    expect(textToRichTextDoc("  first\r\n\nsecond \n")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "first" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "second" }] }
      ]
    });
  });
});

describe("richTextToPlainText", () => {
  it("reads nothing from an empty or missing value", () => {
    expect(richTextToPlainText(null)).toBe("");
    expect(richTextToPlainText(undefined)).toBe("");
    expect(richTextToPlainText({})).toBe("");
    expect(richTextToPlainText(42)).toBe("");
    expect(richTextToPlainText({ type: "doc", content: [] })).toBe("");
  });

  it("passes a string through, trimmed", () => {
    expect(richTextToPlainText("  leaks at the fitting ")).toBe(
      "leaks at the fitting"
    );
  });

  it("round-trips the text textToRichTextDoc builds", () => {
    const text = "first\n\nsecond";
    expect(richTextToPlainText(textToRichTextDoc(text))).toBe(text);
  });

  it("joins marks within a paragraph and breaks lines at hard breaks", () => {
    expect(
      richTextToPlainText({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Runs " },
              { type: "text", text: "hot", marks: [{ type: "bold" }] },
              { type: "hardBreak" },
              { type: "text", text: "and noisy" }
            ]
          }
        ]
      })
    ).toBe("Runs hot\nand noisy");
  });

  it("puts list items on their own lines without blank lines between", () => {
    expect(
      richTextToPlainText({
        type: "doc",
        content: [
          { type: "heading", content: [{ type: "text", text: "Symptoms" }] },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "a" }] }
                ]
              },
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "b" }] }
                ]
              }
            ]
          }
        ]
      })
    ).toBe("Symptoms\na\nb");
  });

  it("reads a mention by its label and drops images", () => {
    expect(
      richTextToPlainText({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Swap " },
              { type: "mention", attrs: { id: "itm_1", label: "ST-050" } }
            ]
          },
          { type: "image", attrs: { src: "/x.png" } }
        ]
      })
    ).toBe("Swap ST-050");
  });
});
