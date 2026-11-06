// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LabelSize, ProductLabelItem } from "@carbon/utils";
import { labelSizes } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { resolveTemplate } from "../template";
import { generateProductLabelZPL } from "./ProductLabelZPL";

const item: ProductLabelItem = {
  itemId: "WIDGET-100",
  revision: "A",
  quantity: 5,
  number: "SN-0001",
  trackedEntityId: "dtClCvNm9blDY0H3FXmDC",
  trackingType: "Serial"
};

const zplSizes = labelSizes.filter((s) => s.zpl);
const size = (id: string): LabelSize => {
  const found = labelSizes.find((s) => s.id === id);
  if (!found) throw new Error(`Missing label size ${id}`);
  return found;
};

/** Template exercising every barcode placement path (right/full/center). */
const allPlacementsTemplate = {
  ...resolveTemplate("trackingLabel", null),
  blocks: [
    { id: "h", type: "labelHeading" as const, visible: true },
    {
      id: "b1",
      type: "labelBarcode" as const,
      visible: true,
      symbology: "code128" as const,
      value: "{label.trackedEntityId}",
      placement: "right" as const
    },
    {
      id: "b2",
      type: "labelBarcode" as const,
      visible: true,
      symbology: "qrcode" as const,
      value: "{label.trackedEntityId}",
      placement: "center" as const
    },
    {
      id: "b3",
      type: "labelBarcode" as const,
      visible: true,
      symbology: "code128" as const,
      value: "{label.trackedEntityId}",
      placement: "full" as const
    }
  ]
};

describe("generateProductLabelZPL", () => {
  it("emits the standard header (size, no media tracking, UTF-8)", () => {
    for (const s of zplSizes) {
      const dpi = s.zpl!.dpi || 203;
      const zpl = generateProductLabelZPL(item, s);
      expect(zpl.startsWith("^XA")).toBe(true);
      expect(zpl).toContain(`^PW${Math.round(s.zpl!.width * dpi)}`);
      expect(zpl).toContain(`^LL${Math.round(s.zpl!.height * dpi)}`);
      expect(zpl).toContain("^MNW^CI28");
      expect(zpl.endsWith("^XZ")).toBe(true);
    }
  });

  it("QR codes carry the MA, prefix (error correction + auto mode)", () => {
    const zpl = generateProductLabelZPL(item, size("label2x1"));
    expect(zpl).toContain(`^FDMA,${item.trackedEntityId}`);
  });

  it("QR module size scales with the label stock", () => {
    expect(generateProductLabelZPL(item, size("label2x1"))).toContain(
      "^BQN,2,4"
    );
    expect(generateProductLabelZPL(item, size("label4x2"))).toContain(
      "^BQN,2,8"
    );
  });

  it("fonts and margins scale with the label stock", () => {
    // 2x1 = baseline scale 1; 4x2 = scale 2.
    expect(generateProductLabelZPL(item, size("label2x1"))).toContain(
      "^FO20,30^A0N,25,25"
    );
    expect(generateProductLabelZPL(item, size("label4x2"))).toContain(
      "^FO40,60^A0N,50,50"
    );
  });

  it("emits only integer coordinates and sizes for every placement", () => {
    for (const s of zplSizes) {
      const zpl = generateProductLabelZPL(item, s, allPlacementsTemplate);
      expect(zpl).not.toMatch(/\d+\.\d+/);
    }
  });

  it("escapes a caret in label text so it cannot end the field", () => {
    const zpl = generateProductLabelZPL(
      { ...item, itemId: "AB^CD" },
      size("label2x1")
    );
    expect(zpl).toContain("^FH^FDAB_5ECD^FS");
    expect(zpl).not.toContain("^FDAB^CD");
  });

  it("escapes a caret in a barcode's value so it cannot start a command", () => {
    const zpl = generateProductLabelZPL(
      { ...item, trackedEntityId: "AB^PQ100" },
      size("label2x1")
    );
    expect(zpl).toContain("^FH^FDMA,AB_5EPQ100^FS");
    expect(zpl).not.toContain("AB^PQ100");
  });

  it("prints a custom field's value alone when its label is empty", () => {
    const template = resolveTemplate("trackingLabel", null);
    const zpl = generateProductLabelZPL(
      { ...item, customFields: { cf1: "Blue" } },
      size("label2x1"),
      {
        ...template,
        blocks: [
          ...template.blocks,
          {
            id: "c",
            type: "customField",
            visible: true,
            fieldId: "cf1",
            label: ""
          }
        ]
      }
    );
    expect(zpl).toContain("^FH^FDBlue^FS");
    expect(zpl).not.toContain(": Blue");
  });

  it("throws for sizes without ZPL support", () => {
    expect(() => generateProductLabelZPL(item, size("avery5163"))).toThrow();
  });
});

describe("trackingLabel default template", () => {
  it("has no page chrome (labels carry no header or footer)", () => {
    const resolved = resolveTemplate("trackingLabel", null);
    expect(resolved.headerSectionId).toBeNull();
    expect(resolved.footerSectionId).toBeNull();
  });
});
