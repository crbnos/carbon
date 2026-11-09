// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { describe, expect, it } from "vitest";
import { keepListItemTogether, makeConvert, markStyle } from "./Note";

const text = (value: string): JSONContent => ({ type: "text", text: value });
const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  content
});
const listItem = (...content: JSONContent[]): JSONContent => ({
  type: "listItem",
  content
});

describe("keepListItemTogether", () => {
  it("keeps a short item whole", () => {
    expect(
      keepListItemTogether(
        listItem(paragraph(text("Net 30 from invoice date")))
      )
    ).toBe(true);
  });

  it("keeps an item with a few short sub-items whole", () => {
    const sub = (value: string) => listItem(paragraph(text(value)));
    expect(
      keepListItemTogether(
        listItem(paragraph(text("Delivery")), {
          type: "bulletList",
          content: [sub("FOB origin"), sub("Freight prepaid"), sub("Insured")]
        })
      )
    ).toBe(true);
  });

  it("lets a long paragraph break across pages", () => {
    expect(
      keepListItemTogether(listItem(paragraph(text("x".repeat(2000)))))
    ).toBe(false);
  });

  // 90 one-word lines are short in text but far taller than a page. Kept whole,
  // the bottom lines would overflow the page and be cut off.
  it("lets an item of many line breaks break across pages", () => {
    const lines = Array.from({ length: 90 }, (_, i) => [
      text(`Line ${i + 1}`),
      { type: "hardBreak" }
    ]).flat();
    expect(keepListItemTogether(listItem(paragraph(...lines)))).toBe(false);
  });

  it("lets an item of many short paragraphs break across pages", () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) =>
      paragraph(text(`Step ${i + 1}`))
    );
    expect(keepListItemTogether(listItem(...paragraphs))).toBe(false);
  });
});

describe("markStyle", () => {
  it("prints bold, underline and strikethrough", () => {
    expect(markStyle([{ type: "bold" }], false)).toEqual({
      fontWeight: "bold"
    });
    expect(markStyle([{ type: "underline" }], false)).toEqual({
      textDecoration: "underline"
    });
    expect(markStyle([{ type: "strike" }], false)).toEqual({
      textDecoration: "line-through"
    });
    expect(markStyle([{ type: "bold" }, { type: "underline" }], false)).toEqual(
      {
        fontWeight: "bold",
        textDecoration: "underline"
      }
    );
  });

  it("prints italic only with an italic face", () => {
    expect(markStyle([{ type: "italic" }], true)).toEqual({
      fontStyle: "italic"
    });
  });

  it("leaves plain text and marks a PDF cannot show alone", () => {
    expect(markStyle(undefined, false)).toBeNull();
    expect(markStyle([], false)).toBeNull();
    expect(markStyle([{ type: "italic" }], false)).toBeNull();
  });
});

describe("a rich-text run", () => {
  const convert = makeConvert({} as never, false);

  it("prints marked text with its style and plain text as it is", () => {
    const bold = convert({
      type: "text",
      text: "Net 30",
      marks: [{ type: "bold" }]
    }) as { props: { style: unknown; children: unknown } };
    expect(bold.props.style).toEqual({ fontWeight: "bold" });
    expect(bold.props.children).toBe("Net 30");
    expect(convert({ type: "text", text: "Net 30" })).toBe("Net 30");
  });
});
