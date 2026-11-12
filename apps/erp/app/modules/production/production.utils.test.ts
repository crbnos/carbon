// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { appendNoteParagraph } from "./production.utils";

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }]
});

describe("appendNoteParagraph", () => {
  it("makes a new document when there are no notes", () => {
    expect(appendNoteParagraph(null, "Added")).toEqual({
      type: "doc",
      content: [paragraph("Added")]
    });
  });

  it("adds a paragraph after the existing content", () => {
    expect(
      appendNoteParagraph(
        { type: "doc", content: [paragraph("First")] },
        "Added"
      )
    ).toEqual({
      type: "doc",
      content: [paragraph("First"), paragraph("Added")]
    });
  });

  it("replaces a value that is not a document", () => {
    expect(appendNoteParagraph("plain text", "Added")).toEqual({
      type: "doc",
      content: [paragraph("Added")]
    });
  });
});
