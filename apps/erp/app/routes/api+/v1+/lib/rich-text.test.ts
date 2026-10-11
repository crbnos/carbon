// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ManifestEntry } from "@carbon/api";
import { describe, expect, it } from "vitest";
import raw from "../../mcp+/lib/tool-metadata.json";
import { toRichTextDocument, withRichTextDocuments } from "./rich-text.server";

// The real generated manifest: what is pinned is that a field the generator
// published as rich text is converted, and a text column of the same name is not.
const schemaOf = (name: string) => {
  const op = (raw as { tools: ManifestEntry[] }).tools.find(
    (t) => t.name === name
  );
  if (!op) throw new Error(`${name} missing from the generated manifest`);
  return op.schema;
};

const BOLD_DOC = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "done", marks: [{ type: "bold" }] }]
    }
  ]
};

describe("toRichTextDocument", () => {
  it("converts Markdown", () => {
    expect(toRichTextDocument("**done**")).toEqual(BOLD_DOC);
  });

  it("decodes a JSON-encoded document, as the app's forms post it", () => {
    expect(toRichTextDocument(JSON.stringify(BOLD_DOC))).toEqual(BOLD_DOC);
  });

  it("treats JSON that is not a document as text", () => {
    expect(toRichTextDocument('{"a":1}')).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: '{"a":1}' }] }
      ]
    });
  });
});

describe("withRichTextDocuments", () => {
  it("converts a Json notes field", () => {
    const schema = schemaOf("sales_updateContractNotes");
    expect(
      withRichTextDocuments(schema, { id: "c1", notes: "**done**" })
    ).toEqual({ id: "c1", notes: BOLD_DOC });
  });

  it("leaves a document and null untouched", () => {
    const schema = schemaOf("sales_updateContractNotes");
    const sent = { id: "c1", notes: BOLD_DOC };
    expect(withRichTextDocuments(schema, sent)).toBe(sent);
    const cleared = { id: "c1", notes: null };
    expect(withRichTextDocuments(schema, cleared)).toBe(cleared);
  });

  it("converts both notes of a quote line and nothing else", () => {
    const schema = schemaOf("sales_upsertQuoteLine");
    const result = withRichTextDocuments(schema, {
      description: "Bracket, *machined*",
      internalNotes: "**done**",
      externalNotes: "**done**"
    });
    expect(result).toEqual({
      description: "Bracket, *machined*",
      internalNotes: BOLD_DOC,
      externalNotes: BOLD_DOC
    });
  });

  it("converts inside a list", () => {
    const schema = schemaOf("settings_upsertDocumentTemplate");
    const result = withRichTextDocuments(schema, {
      blocks: [{ id: "b1", type: "notes", content: "**done**" }]
    }) as { blocks: Array<{ content: unknown }> };
    expect(result.blocks[0]?.content).toEqual(BOLD_DOC);
  });

  it("never touches a plain-text notes column", () => {
    const schema = schemaOf("sales_insertQuote");
    const sent = { customerId: "c1", notes: "**literal**" };
    expect(withRichTextDocuments(schema, sent)).toBe(sent);
  });
});
