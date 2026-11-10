// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// @vitest-environment jsdom

import { act } from "react";
import type { Root } from "react-dom/client";
import { hydrateRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { generateHTML, isRichTextEmpty, RichTextView } from "./HTML";

describe("RichTextView", () => {
  it("fills in the text when it hydrates the server's empty markup", () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Net 30" }] }
      ]
    };
    // generateHTML needs the DOM, so the server sends the element empty.
    const container = document.createElement("div");
    container.innerHTML = '<div class="prose dark:prose-invert"></div>';
    document.body.appendChild(container);

    let root: Root | undefined;
    act(() => {
      root = hydrateRoot(
        container,
        <RichTextView content={doc} empty={null} />
      );
    });

    expect(container.textContent).toBe("Net 30");
    act(() => root?.unmount());
    container.remove();
  });
});

// A work instruction stored as a JSON string scalar crashed the MES operation
// page: `"type" in "<text>"` throws. Strings are now read as documents.
describe("rich text stored as a string", () => {
  const note = "Check the fit-up before tacking.";

  it("renders plain text instead of throwing", () => {
    expect(generateHTML(note as never)).toBe(`<p>${note}</p>`);
    expect(isRichTextEmpty(note as never)).toBe(false);
  });

  it("reads a document encoded as text", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: note }] }]
    };
    expect(generateHTML(JSON.stringify(doc) as never)).toBe(`<p>${note}</p>`);
    expect(isRichTextEmpty(JSON.stringify(doc) as never)).toBe(false);
    expect(isRichTextEmpty(JSON.stringify({ type: "doc" }) as never)).toBe(
      true
    );
  });

  it("treats an empty string as empty", () => {
    expect(generateHTML("" as never)).toBe("");
    expect(isRichTextEmpty("" as never)).toBe(true);
  });
});
