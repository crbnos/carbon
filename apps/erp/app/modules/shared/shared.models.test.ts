// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  normalizeOperationSourceIds,
  optionalTiptapDoc,
  toTiptapDoc
} from "./shared.models";

// Rich-text columns are `json` and must hold a tiptap document OBJECT. A JSON
// string scalar stored there later breaks every Kysely copy of the row
// (the Postgres driver sends a string parameter as raw text). These pin the one
// coercion every writer goes through.

const doc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }]
};

describe("toTiptapDoc", () => {
  it("wraps plain text into a document", () => {
    expect(toTiptapDoc("hi")).toEqual(doc);
  });

  it("keeps line breaks as paragraphs", () => {
    expect(toTiptapDoc("a\nb")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph", content: [{ type: "text", text: "b" }] }
      ]
    });
  });

  it("parses a JSON-encoded document (form post)", () => {
    expect(toTiptapDoc(JSON.stringify(doc))).toEqual(doc);
  });

  it("passes a document object through untouched (JSON body)", () => {
    expect(toTiptapDoc(doc)).toBe(doc);
  });

  it("never returns a string, array, or scalar", () => {
    for (const value of ['"quoted"', "123", "[1,2]", 7, true, ["x"]]) {
      const out = toTiptapDoc(value);
      expect(typeof out).toBe("object");
      expect(Array.isArray(out)).toBe(false);
      expect(out.type).toBe("doc");
    }
  });

  it("keeps text that merely looks like JSON, characters intact", () => {
    // `123` parses as a number, `[1,2]` as an array and `"quoted"` as a bare
    // string — none is a doc, so the ORIGINAL text is stored verbatim; the
    // parse must not strip the quote characters the user typed.
    for (const text of ["123", "[1,2]", '"quoted"']) {
      expect(toTiptapDoc(text)).toEqual({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }]
      });
    }
  });
});

describe("optionalTiptapDoc", () => {
  it("leaves the column untouched when absent or empty", () => {
    expect(optionalTiptapDoc.parse(undefined)).toBeUndefined();
    expect(optionalTiptapDoc.parse("")).toBeUndefined();
  });

  it("accepts a string and stores a document", () => {
    expect(optionalTiptapDoc.parse("hi")).toEqual(doc);
  });

  it("accepts a document object", () => {
    expect(optionalTiptapDoc.parse(doc)).toEqual(doc);
  });

  it("rejects shapes that could never be a document", () => {
    expect(optionalTiptapDoc.safeParse(42).success).toBe(false);
    expect(optionalTiptapDoc.safeParse(["x"]).success).toBe(false);
    expect(optionalTiptapDoc.safeParse(null).success).toBe(false);
  });
});

// Outside Processing is done at the supplier, so it has no work center. The
// form hides the field for that type and an update leaves an omitted column as
// it was, so a work center set while the operation was in-house survived the
// switch — and put the subcontracted operation on the MES Work Centers board.
describe("normalizeOperationSourceIds", () => {
  it("clears the work center of an Outside Processing operation", () => {
    expect(
      normalizeOperationSourceIds({
        operationType: "Outside Processing",
        workCenterId: "wc1"
      }).workCenterId
    ).toBeNull();
  });

  it("clears it even when the form omitted the field", () => {
    const normalized = normalizeOperationSourceIds<{
      operationType?: string;
      workCenterId?: string | null;
    }>({ operationType: "Outside Processing" });
    expect(normalized).toHaveProperty("workCenterId", null);
  });

  it("keeps the work center of an in-house operation", () => {
    expect(
      normalizeOperationSourceIds({
        operationType: "Process",
        workCenterId: "wc1"
      }).workCenterId
    ).toBe("wc1");
  });

  it("does not add a work center to an in-house operation that omitted it", () => {
    expect(
      normalizeOperationSourceIds({ operationType: "Process" })
    ).not.toHaveProperty("workCenterId");
  });
});
