// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { describe, expect, it } from "vitest";
import { keepListItemTogether } from "./Note";

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
