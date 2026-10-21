// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { documentHasImages, textToTiptap } from "./tiptap";

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

describe("textToTiptap", () => {
  it("makes each line a paragraph and **text** bold", () => {
    expect(
      textToTiptap("Tap with **TiN-coated** tap.\n\nChase a ** b")
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
      expect(textToTiptap(text).content).toEqual([
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "M6*1 tap", marks: [{ type: "bold" }] }
          ]
        }
      ]);
    }
  });
});
