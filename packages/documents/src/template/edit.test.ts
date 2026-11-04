// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { resolveTemplate } from "./defaults";
import {
  applyDocumentEdit,
  diffDocumentEdit,
  isEmptyDocumentEdit
} from "./edit";
import type { DocumentTemplate } from "./schema";

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

  it("hides a block, replaces the hidden list and sets the document title", () => {
    const printed = applyDocumentEdit(companyTemplate(), {
      blocks: {
        notes: { visible: false },
        parties: { hidden: ["supplierVat"] }
      },
      settings: { text: { title: "Purchase Order (copy)" } }
    });
    expect(block(printed, "notes")?.visible).toBe(false);
    expect(block(printed, "parties")?.hidden).toEqual(["supplierVat"]);
    expect(printed.settings.text).toEqual({ title: "Purchase Order (copy)" });
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
          hidden: ["supplierEori", "supplierVat"]
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
        b.id === "parties" ? { ...b, text: { supplierTaxId: "Tax ID:" } } : b
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
});
