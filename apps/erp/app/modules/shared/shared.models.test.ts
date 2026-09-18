import { describe, expect, it } from "vitest";
import { optionalTiptapDoc, toTiptapDoc } from "./shared.models";

// Rich-text columns are `json` and must hold a tiptap document OBJECT. A JSON
// string scalar stored there later breaks every Kysely copy of the row
// (deno-postgres sends a string parameter as raw text). These pin the one
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
