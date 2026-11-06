// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { resolveTemplate } from "./defaults";
import {
  applyDocumentEdit,
  diffDocumentEdit,
  editToPrint,
  isEmptyDocumentEdit,
  isFigureProblem,
  printedNotes,
  validateDocumentEdit,
  withoutLockedValues
} from "./edit";
import {
  blockSchema,
  type DocumentTemplate,
  toDocumentTemplate
} from "./schema";

/** The company template: "Supplier" renamed, "EORI:" hidden. */
function companyTemplate(): DocumentTemplate {
  const template = resolveTemplate("purchaseOrder", null);
  return {
    ...template,
    blocks: template.blocks.map((block) =>
      block.id === "parties"
        ? { ...block, text: { supplier: "Vendor" }, hidden: ["supplierEori"] }
        : block
    )
  };
}

const block = (template: DocumentTemplate, id: string) =>
  template.blocks.find((b) => b.id === id);

describe("applyDocumentEdit", () => {
  it("overrides a changed word and keeps the template's other words", () => {
    const printed = applyDocumentEdit(companyTemplate(), {
      blocks: { parties: { text: { supplierTaxId: "GST No.:" } } },
      settings: {}
    });
    expect(block(printed, "parties")).toMatchObject({
      text: { supplier: "Vendor", supplierTaxId: "GST No.:" },
      hidden: ["supplierEori"]
    });
  });

  it("hides a block, changes the hidden list and sets the document title", () => {
    const printed = applyDocumentEdit(companyTemplate(), {
      blocks: {
        notes: { visible: false },
        parties: { hide: ["supplierVat"], show: ["supplierEori"] }
      },
      settings: { text: { title: "Purchase Order (copy)" } }
    });
    expect(block(printed, "notes")?.visible).toBe(false);
    expect(block(printed, "parties")?.hidden).toEqual(["supplierVat"]);
    expect(printed.settings.text).toEqual({ title: "Purchase Order (copy)" });
  });

  it("follows what the template hides later, keeping the document's own", () => {
    const base = companyTemplate();
    const edit = diffDocumentEdit("purchaseOrder", base, {
      ...base,
      blocks: base.blocks.map((b) =>
        b.id === "parties"
          ? { ...b, hidden: ["supplierEori", "supplierVat"] }
          : b
      )
    });
    const later = {
      ...base,
      blocks: base.blocks.map((b) =>
        b.id === "parties" ? { ...b, hidden: ["supplierEori", "date"] } : b
      )
    };
    expect(block(applyDocumentEdit(later, edit), "parties")?.hidden).toEqual([
      "supplierEori",
      "date",
      "supplierVat"
    ]);
  });

  it("ignores an edit for a block the template no longer has", () => {
    const template = companyTemplate();
    const printed = applyDocumentEdit(template, {
      blocks: { gone: { visible: false } },
      settings: {}
    });
    expect(printed.blocks).toEqual(template.blocks);
  });

  it("returns the template unchanged without an edit", () => {
    const template = companyTemplate();
    expect(applyDocumentEdit(template, null)).toBe(template);
  });
});

describe("diffDocumentEdit", () => {
  it("is empty when nothing changed", () => {
    const template = companyTemplate();
    expect(
      isEmptyDocumentEdit(diffDocumentEdit("purchaseOrder", template, template))
    ).toBe(true);
  });

  it("keeps only the words, toggles and blocks that differ", () => {
    const base = companyTemplate();
    const edited = {
      ...base,
      blocks: base.blocks.map((b) =>
        b.id === "parties"
          ? {
              ...b,
              // "Vendor" is the template's word, so it is no change.
              text: { supplier: "Vendor", supplierTaxId: "GST No.:" },
              hidden: ["supplierEori", "supplierVat"]
            }
          : b.id === "notes"
            ? { ...b, visible: false }
            : b
      )
    };
    expect(diffDocumentEdit("purchaseOrder", base, edited)).toEqual({
      blocks: {
        parties: {
          text: { supplierTaxId: "GST No.:" },
          hide: ["supplierVat"]
        },
        notes: { visible: false }
      },
      settings: {}
    });
  });

  it("drops a word typed back to the catalog default", () => {
    const base = resolveTemplate("purchaseOrder", null);
    const edited = {
      ...base,
      blocks: base.blocks.map((b) =>
        b.id === "parties"
          ? { ...b, text: { supplierTaxId: "Tax ID: {supplier.taxId}" } }
          : b
      )
    };
    expect(
      isEmptyDocumentEdit(diffDocumentEdit("purchaseOrder", base, edited))
    ).toBe(true);
  });

  it("prints what the editor showed once applied to the template", () => {
    const base = companyTemplate();
    const edited = {
      ...base,
      blocks: base.blocks.map((b) =>
        b.id === "parties"
          ? { ...b, text: { supplier: "Seller" }, hidden: [] }
          : b
      ),
      settings: { ...base.settings, text: { title: "Order" } }
    };
    const printed = applyDocumentEdit(
      base,
      diffDocumentEdit("purchaseOrder", base, edited)
    );
    expect(block(printed, "parties")).toMatchObject({
      text: { supplier: "Seller" },
      hidden: []
    });
    expect(printed.settings.text).toEqual({ title: "Order" });
  });

  it("wraps the line table when a row's value changed, and only then", () => {
    const base = resolveTemplate("purchaseOrder", null);
    const overflow = (edit: Parameters<typeof applyDocumentEdit>[1]) => {
      const block = applyDocumentEdit(
        {
          ...base,
          blocks: base.blocks.map((b) =>
            b.type === "lineItems"
              ? { ...b, options: { ...b.options, textOverflow: "truncate" } }
              : b
          )
        } as typeof base,
        edit
      ).blocks.find((b) => b.type === "lineItems");
      return block?.type === "lineItems" ? block.options?.textOverflow : null;
    };
    expect(
      overflow({
        blocks: {},
        settings: {
          valueEdits: { rows: { "line:a": { "line.details": "Two\nlines" } } }
        }
      })
    ).toBe("wrap");
    expect(
      overflow({
        blocks: {},
        settings: { valueEdits: { document: { "order.date": "Soon" } } }
      })
    ).toBe("truncate");
  });
});

describe("validateDocumentEdit", () => {
  const template = resolveTemplate("purchaseOrder", {
    ...toDocumentTemplate(null, "purchaseOrder"),
    blocks: [
      {
        id: "words",
        type: "richText",
        visible: true,
        content: { type: "doc", content: [{ type: "text", text: "{gone.x}" }] }
      }
    ]
  });
  const none = { blocks: {}, settings: {} };

  it("ignores the company template's own problem", () => {
    expect(validateDocumentEdit("purchaseOrder", template, none)).toEqual([]);
  });

  it("reports what the edit itself got wrong", () => {
    const edit = {
      blocks: { lineItems: { text: { qtyCell: "999" } } },
      settings: { text: { title: "{gone.y}" } }
    };
    expect(
      validateDocumentEdit("purchaseOrder", template, edit).map((p) => p.field)
    ).toEqual(expect.arrayContaining(["qtyCell", "title"]));
  });

  it("always reports a locked value", () => {
    const edit = {
      blocks: {},
      settings: { valueEdits: { document: { "order.total": "$1" } } }
    };
    const problems = validateDocumentEdit("purchaseOrder", template, edit);
    expect(problems).toMatchObject([{ code: "valueLocked" }]);
    expect(problems.every(isFigureProblem)).toBe(true);
  });
});

describe("editToPrint", () => {
  const template = resolveTemplate("purchaseOrder", null);
  const saved = { blocks: {}, settings: { text: { title: "Saved words" } } };
  const print = (args: {
    locked?: boolean;
    isDownload?: boolean;
    draft: Parameters<typeof editToPrint>[0]["draft"];
  }) =>
    editToPrint({
      documentType: "purchaseOrder",
      locked: false,
      isDownload: false,
      readSaved: async () => saved,
      readTemplate: async () => template,
      ...args
    });
  const typedTotal = {
    blocks: template.blocks.map((block) =>
      block.type === "summary"
        ? { ...block, text: { totalValue: "$1" } }
        : block
    ),
    settings: template.settings
  };
  // Not a figure: a save refuses it, a preview shows it.
  const unknownVariable = {
    blocks: template.blocks,
    settings: { ...template.settings, text: { title: "{nope}" } }
  };

  it("prints a locked record's saved edit, whatever was posted", async () => {
    expect(await print({ locked: true, draft: typedTotal })).toEqual({
      edit: saved
    });
    expect(await print({ locked: true, draft: null })).toEqual({ edit: saved });
  });

  it("refuses a draft that takes a figure out, in a preview and a download", async () => {
    for (const isDownload of [false, true]) {
      expect(await print({ isDownload, draft: typedTotal })).toMatchObject({
        refused: expect.stringContaining("must stay")
      });
    }
  });

  it("refuses what a save would only on a download", async () => {
    expect(await print({ draft: unknownVariable })).toHaveProperty("edit");
    expect(
      await print({ isDownload: true, draft: unknownVariable })
    ).toMatchObject({ refused: expect.stringContaining("{nope}") });
  });

  it("prints only what the draft changes, with its notes", async () => {
    const notes = { type: "doc", content: [] };
    expect(
      await print({
        draft: {
          blocks: template.blocks,
          settings: { ...template.settings, text: { title: "Typed" } },
          notes
        }
      })
    ).toEqual({
      edit: {
        blocks: {},
        settings: { text: { title: "Typed" } },
        notes
      }
    });
  });

  it("refuses a draft it could not read on an open record", async () => {
    expect(await print({ draft: null })).toEqual({
      refused: "Invalid document"
    });
  });
});

describe("withoutLockedValues", () => {
  it("drops a stored value for a variable that is locked", () => {
    const edit = withoutLockedValues("purchaseOrder", {
      blocks: {},
      settings: {
        valueEdits: {
          document: { "order.total": "$1", "order.date": "Soon" },
          rows: { "line:a": { "line.total": "$1", "line.details": "Bus" } }
        }
      }
    });
    expect(edit.settings.valueEdits).toEqual({
      document: { "order.date": "Soon" },
      rows: { "line:a": { "line.details": "Bus" } }
    });
  });
});

describe("a stored template", () => {
  it("never carries changed values", () => {
    const template = toDocumentTemplate(
      {
        blocks: [],
        theme: {},
        settings: { valueEdits: { document: { "order.total": "$1" } } }
      },
      "purchaseOrder"
    );
    expect(template?.settings.valueEdits).toBeUndefined();
  });
});

describe("unsaved notes", () => {
  const template = resolveTemplate("purchaseOrder", null);
  const notesBlock = (blocks: typeof template.blocks) =>
    blocks.find((block) => block.type === "notes")!;
  const typed = { type: "doc", content: [] };

  it("print in place of the record's, even when emptied", () => {
    const printed = applyDocumentEdit(template, {
      blocks: {},
      settings: {},
      notes: typed
    });
    expect(printedNotes(notesBlock(printed.blocks), { old: true })).toEqual(
      typed
    );
    const cleared = applyDocumentEdit(template, {
      blocks: {},
      settings: {},
      notes: null
    });
    expect(printedNotes(notesBlock(cleared.blocks), { old: true })).toBeNull();
  });

  it("leave the record's notes when the draft has none", () => {
    const printed = applyDocumentEdit(template, { blocks: {}, settings: {} });
    expect(printedNotes(notesBlock(printed.blocks), { old: true })).toEqual({
      old: true
    });
  });

  it("cannot be posted or saved as part of a block", () => {
    const parsed = blockSchema.parse({
      id: "notes",
      type: "notes",
      visible: true,
      draftNotes: typed
    });
    expect("draftNotes" in parsed).toBe(false);
  });
});
