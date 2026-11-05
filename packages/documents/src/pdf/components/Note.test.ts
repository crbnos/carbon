// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { makeConvert, markStyle } from "./Note";

describe("markStyle", () => {
  it("prints bold, underline and strikethrough", () => {
    expect(markStyle([{ type: "bold" }])).toEqual({ fontWeight: "bold" });
    expect(markStyle([{ type: "underline" }])).toEqual({
      textDecoration: "underline"
    });
    expect(markStyle([{ type: "strike" }])).toEqual({
      textDecoration: "line-through"
    });
    expect(markStyle([{ type: "bold" }, { type: "underline" }])).toEqual({
      fontWeight: "bold",
      textDecoration: "underline"
    });
  });

  it("leaves plain text and marks a PDF cannot show alone", () => {
    expect(markStyle(undefined)).toBeNull();
    expect(markStyle([])).toBeNull();
    expect(markStyle([{ type: "italic" }])).toBeNull();
  });
});

describe("a rich-text run", () => {
  const convert = makeConvert({} as never);

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
