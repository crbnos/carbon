import { describe, expect, it } from "vitest";
import { renderInlineLinks, renderSlackMrkdwn } from "./index";

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

describe("renderSlackMrkdwn", () => {
  it("rewrites a Carbon link as Slack mrkdwn", () => {
    expect(renderSlackMrkdwn(`Check [SO000123](${HREF})`, ORIGIN)).toBe(
      `Check <${HREF}|SO000123>`
    );
  });

  it("leaves a link on another host as literal text", () => {
    const body = "[click](https://evil.example/steal)";
    expect(renderSlackMrkdwn(body, ORIGIN)).toBe(
      "[click](https://evil.example/steal)"
    );
  });

  // `|` would terminate the label, and Slack reads bare `&`/`<`/`>` as markup.
  it("escapes Slack's control characters in both a label and plain text", () => {
    expect(renderSlackMrkdwn(`A & B <c> [x|y](${HREF})`, ORIGIN)).toBe(
      `A &amp; B &lt;c&gt; <${HREF}|x¦y>`
    );
  });

  it("returns an empty string for an empty message", () => {
    expect(renderSlackMrkdwn("", ORIGIN)).toBe("");
  });
});
