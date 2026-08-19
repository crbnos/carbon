import { describe, expect, it } from "vitest";
import { renderInlineLinks } from "./index";

const ORIGIN = "https://app.carbon.ms";
const HREF = `${ORIGIN}/api/link?event=workflow&documentId=so_1`;

describe("renderInlineLinks", () => {
  it("returns nothing for an empty string", () => {
    expect(renderInlineLinks("", ORIGIN)).toEqual([]);
  });

  it("returns plain text as a single segment", () => {
    expect(renderInlineLinks("Nothing to see", ORIGIN)).toEqual([
      { text: "Nothing to see" }
    ]);
  });

  it("splits a link out of the surrounding text", () => {
    expect(
      renderInlineLinks(`Check [SO000123](${HREF}) today`, ORIGIN)
    ).toEqual([
      { text: "Check " },
      { text: "SO000123", href: HREF },
      { text: " today" }
    ]);
  });

  it("handles two links in one body", () => {
    const body = `[A](${HREF}) and [B](${HREF})`;
    expect(renderInlineLinks(body, ORIGIN)).toEqual([
      { text: "A", href: HREF },
      { text: " and " },
      { text: "B", href: HREF }
    ]);
  });

  // The reason this function exists: the body is customer-authored.
  it("leaves a javascript: url as literal text", () => {
    const body = "[click](javascript:alert(1))";
    expect(renderInlineLinks(body, ORIGIN)).toEqual([{ text: body }]);
  });

  it("leaves another host as literal text", () => {
    const body = "[click](https://evil.example/steal)";
    expect(renderInlineLinks(body, ORIGIN)).toEqual([{ text: body }]);
  });

  it("leaves a plain http url as literal text", () => {
    const body = "[click](http://app.carbon.ms/x)";
    expect(renderInlineLinks(body, ORIGIN)).toEqual([{ text: body }]);
  });

  it("leaves a relative path as literal text", () => {
    const body = "[click](/x/sales/orders)";
    expect(renderInlineLinks(body, ORIGIN)).toEqual([{ text: body }]);
  });

  it("treats an unparseable origin as no origin at all", () => {
    const body = `Check [SO000123](${HREF})`;
    expect(renderInlineLinks(body, "")).toEqual([{ text: body }]);
  });
});
