// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { TiptapText } from "@carbon/files/markdown";
import { describe, expect, it } from "vitest";
import {
  normalizeOperationSourceIds,
  operationStepValidator,
  optionalPlainTextDoc,
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

  it("keeps a line break inside the paragraph, as Markdown does", () => {
    expect(toTiptapDoc("a\nb")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "hardBreak" },
            { type: "text", text: "b" }
          ]
        }
      ]
    });
  });

  it("reads text as Markdown", () => {
    expect(toTiptapDoc("## Setup\n\n- [Spec](https://x.test)")).toEqual({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Setup" }]
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Spec",
                      marks: [
                        {
                          type: "link",
                          attrs: { href: "https://x.test", title: null }
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
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

  // A malformed object reached the column and the editor's initial content.
  it("rejects an object that is not a document", () => {
    expect(optionalTiptapDoc.safeParse({ a: 1 }).success).toBe(false);
    expect(optionalTiptapDoc.safeParse({ type: "paragraph" }).success).toBe(
      false
    );
  });

  it("rejects a document whose content is not a list of nodes", () => {
    expect(
      optionalTiptapDoc.safeParse({ type: "doc", content: "bad" }).success
    ).toBe(false);
    expect(
      optionalTiptapDoc.safeParse({
        type: "doc",
        content: [{ type: "paragraph", content: [{ text: "no type" }] }]
      }).success
    ).toBe(false);
  });

  it("takes `{}` as an empty document", () => {
    expect(optionalTiptapDoc.parse({})).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }]
    });
  });
});

describe("optionalPlainTextDoc", () => {
  // Contract notes are a textarea read back with `TiptapText(…).toString()`: a Markdown
  // list there came back without its numbers, and the next save kept that.
  it("stores text as typed, so it reads back unchanged", () => {
    const text = "1. Ship\n2. Install a*b*c";
    expect(TiptapText(optionalPlainTextDoc.parse(text)).toString()).toBe(text);
  });

  it("still accepts a document object", () => {
    expect(optionalPlainTextDoc.parse(doc)).toEqual(doc);
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

  // A partial update (API) that left the type's own link out kept nothing:
  // the link was written as null and the procedure came off the operation.
  it("keeps the type's own link when it was left out", () => {
    expect(
      normalizeOperationSourceIds<{
        operationType?: string;
        procedureId?: string | null;
      }>({ operationType: "Process" })
    ).not.toHaveProperty("procedureId");
  });

  it("clears the type's own link when it was sent empty", () => {
    expect(
      normalizeOperationSourceIds({
        operationType: "Process",
        procedureId: undefined
      }).procedureId
    ).toBeNull();
  });

  it("clears the other types' links", () => {
    const normalized = normalizeOperationSourceIds<{
      operationType?: string;
      procedureId?: string | null;
      assemblyInstructionId?: string | null;
    }>({ operationType: "Assembly", procedureId: "proc1" });
    expect(normalized.procedureId).toBeNull();
    expect(normalized).not.toHaveProperty("assemblyInstructionId");
    expect(normalized).toHaveProperty("inspectionDocumentId", null);
  });

  it("does not add a work center to an in-house operation that omitted it", () => {
    expect(
      normalizeOperationSourceIds({ operationType: "Process" })
    ).not.toHaveProperty("workCenterId");
  });
});

// A List step needs at least one option. The error must sit on `listValues`,
// the field the step forms render: on any other path the form refused the save
// with no message. Blank rows are dropped first, so the empty row "Add option"
// leaves behind never blocks a save and is never stored.
describe("operationStepValidator list options", () => {
  const listStep = (listValues?: string[]) => ({
    operationId: "op1",
    name: "Pick a finish",
    description: "Choose one",
    type: "List" as const,
    listValues
  });

  const listValuesError = (listValues?: string[]) => {
    const result = operationStepValidator.safeParse(listStep(listValues));
    if (result.success) return undefined;
    return result.error.issues.find(
      (issue) => issue.path.join(".") === "listValues"
    )?.message;
  };

  it("puts the missing-options error on the listValues field", () => {
    expect(listValuesError(undefined)).toBe("List options are required");
    expect(listValuesError([])).toBe("List options are required");
  });

  it("treats a list of blank rows as no options", () => {
    expect(listValuesError(["", "  "])).toBe("List options are required");
  });

  it("drops a trailing empty row instead of refusing the save", () => {
    const result = operationStepValidator.safeParse(
      listStep(["Matte", "Gloss", ""])
    );
    expect(result.success).toBe(true);
    expect(result.data?.listValues).toEqual(["Matte", "Gloss"]);
  });

  it("does not require options on other step types", () => {
    expect(
      operationStepValidator.safeParse({ ...listStep(), type: "Task" }).success
    ).toBe(true);
  });
});
