// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  BLOCK_META,
  DEFAULT_SALES_INVOICE_TEMPLATE,
  documentThemeColors,
  keepSummaryWithLineItems,
  resolveTemplate
} from "./defaults";
import { interpolateContent } from "./merge";
import { blockSchema, documentTemplateSchema } from "./schema";

describe("documentThemeColors", () => {
  it("gives table documents the full color set", () => {
    expect(documentThemeColors("salesInvoice")).toEqual([
      "accent",
      "accentForeground",
      "heading",
      "text"
    ]);
  });

  it("gives the issue document headings + body only (no accent bar)", () => {
    expect(documentThemeColors("issue")).toEqual(["heading", "text"]);
  });

  it("gives labels and the job traveler no theme colors", () => {
    expect(documentThemeColors("trackingLabel")).toEqual([]);
    expect(documentThemeColors("jobTraveler")).toEqual([]);
  });
});

describe("resolveTemplate", () => {
  it("falls back to the default template when nothing is stored", () => {
    expect(resolveTemplate("salesInvoice", undefined)).toEqual(
      DEFAULT_SALES_INVOICE_TEMPLATE
    );
    expect(resolveTemplate("salesInvoice", { blocks: [] })).toEqual(
      DEFAULT_SALES_INVOICE_TEMPLATE
    );
  });

  it("preserves stored block order and visibility", () => {
    const stored = [
      { id: "lineItems", type: "lineItems" as const, visible: true },
      { id: "summary", type: "summary" as const, visible: true },
      { id: "header", type: "header" as const, visible: false },
      { id: "parties", type: "parties" as const, visible: true },
      { id: "notes", type: "notes" as const, visible: true },
      { id: "terms", type: "terms" as const, visible: true }
    ];
    const { blocks } = resolveTemplate("salesInvoice", { blocks: stored });
    expect(blocks.map((b) => b.type)).toEqual([
      "lineItems",
      "summary",
      "header",
      "parties",
      "notes",
      "terms",
      // watermark is a built-in not in the stored set, appended hidden
      "watermark"
    ]);
    expect(blocks.find((b) => b.type === "header")?.visible).toBe(false);
    expect(blocks.find((b) => b.type === "watermark")?.visible).toBe(false);
  });

  it("appends missing built-in blocks as hidden", () => {
    const stored = [
      { id: "lineItems", type: "lineItems" as const, visible: true },
      { id: "summary", type: "summary" as const, visible: true }
    ];
    const { blocks } = resolveTemplate("salesInvoice", { blocks: stored });
    const header = blocks.find((b) => b.type === "header");
    expect(header).toBeDefined();
    expect(header?.visible).toBe(false);
    // stored blocks stay first, appended built-ins follow
    expect(blocks.slice(0, 2).map((b) => b.type)).toEqual([
      "lineItems",
      "summary"
    ]);
  });

  it("appends the approval block visible to a stored purchase order", () => {
    const stored = [
      { id: "lineItems", type: "lineItems" as const, visible: true },
      { id: "summary", type: "summary" as const, visible: true }
    ];
    const { blocks } = resolveTemplate("purchaseOrder", { blocks: stored });
    expect(blocks.at(-1)).toEqual({
      id: "approval",
      type: "approval",
      visible: true
    });
    expect(blocks.find((b) => b.type === "header")?.visible).toBe(false);
  });
});

describe("block metadata invariants", () => {
  it("keeps line items and summary non-hideable and non-removable", () => {
    for (const type of ["lineItems", "summary"] as const) {
      expect(BLOCK_META[type].hideable).toBe(false);
      expect(BLOCK_META[type].removable).toBe(false);
    }
  });
});

describe("document settings", () => {
  it("merges a partial stored settings over defaults", () => {
    const { settings } = resolveTemplate("salesInvoice", {
      blocks: [{ id: "summary", type: "summary", visible: true }],
      settings: { showPageNumbers: false }
    });
    expect(settings).toEqual({
      fontFamily: "Inter",
      showPageNumbers: false,
      pageNumberFormat: "pageOfTotal",
      showRegistrationLine: true
    });
  });
});

describe("schema validation", () => {
  it("parses extension blocks and applies defaults", () => {
    const spacer = blockSchema.parse({ id: "s1", type: "spacer" });
    expect(spacer).toMatchObject({ visible: true, variant: "space" });

    const keyValue = blockSchema.parse({ id: "k1", type: "keyValue" });
    expect(keyValue).toMatchObject({ visible: true, rows: [] });
  });

  it("parses built-in blocks with and without options", () => {
    const bare = blockSchema.parse({ id: "header", type: "header" });
    expect(bare).toMatchObject({ type: "header", visible: true });

    const withOptions = blockSchema.parse({
      id: "header",
      type: "header",
      options: { showLogo: false, logoHeight: 40 }
    });
    expect(withOptions).toMatchObject({
      type: "header",
      options: { showLogo: false, logoHeight: 40 }
    });

    const lineItems = blockSchema.parse({
      id: "lineItems",
      type: "lineItems",
      options: { zebra: false }
    });
    expect(lineItems).toMatchObject({ options: { zebra: false } });
  });

  // The preview route and the save validator parse blocks with this schema; an
  // option the schema does not know is stripped and silently ignored.
  it("keeps a hidden supplier part number and shows it on templates saved before the option", () => {
    const parseLineItems = (options: object) =>
      blockSchema.parse({ id: "lineItems", type: "lineItems", options });

    expect(parseLineItems({ showSupplierPartId: false })).toEqual({
      id: "lineItems",
      type: "lineItems",
      visible: true,
      options: {
        showThumbnails: true,
        zebra: true,
        textOverflow: "truncate",
        showSupplierPartId: false
      }
    });
    expect(
      parseLineItems({ zebra: false, textOverflow: "wrap" })
    ).toMatchObject({ options: { showSupplierPartId: true } });
  });

  it("rejects unknown block types", () => {
    expect(() => blockSchema.parse({ id: "x", type: "bogus" })).toThrow();
  });

  it("accepts the default template unchanged", () => {
    expect(
      documentTemplateSchema.parse(DEFAULT_SALES_INVOICE_TEMPLATE)
    ).toEqual(DEFAULT_SALES_INVOICE_TEMPLATE);
  });
});

describe("block text overrides", () => {
  it("keeps a block's changed texts and hidden fields", () => {
    const parsed = blockSchema.parse({
      id: "p",
      type: "parties",
      visible: true,
      text: { taxId: "GST:" },
      hidden: ["eori"]
    });
    expect(parsed.text).toEqual({ taxId: "GST:" });
    expect(parsed.hidden).toEqual(["eori"]);
  });

  it("leaves both unset when the block has none", () => {
    const parsed = blockSchema.parse({ id: "p", type: "parties" });
    expect(parsed.text).toBeUndefined();
    expect(parsed.hidden).toBeUndefined();
  });

  it("keeps the document texts in settings", () => {
    const parsed = documentTemplateSchema.parse({
      ...DEFAULT_SALES_INVOICE_TEMPLATE,
      settings: {
        ...DEFAULT_SALES_INVOICE_TEMPLATE.settings,
        text: { page: "Seite" }
      }
    });
    expect(parsed.settings.text).toEqual({ page: "Seite" });
  });
});

describe("interpolateContent", () => {
  const paragraph = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }]
  });
  const doc = (...content: object[]) => ({ type: "doc", content });
  const approvalLine = paragraph(
    "Approved by {order.approvedBy} on {order.approvedDate}"
  );

  it("fills merge fields", () => {
    expect(
      interpolateContent(doc(approvalLine), {
        "order.approvedBy": "Jordan Lee",
        "order.approvedDate": "Jun 2, 2026"
      })
    ).toEqual(doc(paragraph("Approved by Jordan Lee on Jun 2, 2026")));
  });

  it("leaves out a paragraph whose merge fields are all empty", () => {
    expect(
      interpolateContent(doc(approvalLine, paragraph("Thank you")), {
        "order.approvedBy": "",
        "order.approvedDate": ""
      })
    ).toEqual(doc(paragraph("Thank you")));
  });

  it("keeps a paragraph when one of its merge fields has a value", () => {
    expect(
      interpolateContent(doc(approvalLine), { "order.approvedBy": "Jordan" })
    ).toEqual(doc(paragraph("Approved by Jordan on ")));
  });

  it("keeps paragraphs without merge fields, empty ones included", () => {
    const spacer = { type: "paragraph" };
    expect(interpolateContent(doc(paragraph("Thank you"), spacer), {})).toEqual(
      doc(paragraph("Thank you"), spacer)
    );
  });

  it("leaves out a list whose items all came out empty", () => {
    const list = {
      type: "bulletList",
      content: [{ type: "listItem", content: [approvalLine] }]
    };
    expect(interpolateContent(doc(list), {})).toEqual(doc());
  });
});

describe("keepSummaryWithLineItems", () => {
  const order = (types: string[]) =>
    keepSummaryWithLineItems(types.map((type) => ({ type }))).map(
      (block) => block.type
    );

  it("moves a block out from between the table and its totals", () => {
    expect(
      order(["parties", "lineItems", "richText", "summary", "terms"])
    ).toEqual(["parties", "lineItems", "summary", "richText", "terms"]);
  });

  it("brings the Summary along when Line Items moved down", () => {
    expect(order(["parties", "summary", "terms", "lineItems"])).toEqual([
      "parties",
      "terms",
      "lineItems",
      "summary"
    ]);
  });

  it("leaves a block above the table and a document without both alone", () => {
    expect(order(["richText", "lineItems", "summary"])).toEqual([
      "richText",
      "lineItems",
      "summary"
    ]);
    expect(order(["lineItems", "terms"])).toEqual(["lineItems", "terms"]);
    expect(order(["summary", "terms"])).toEqual(["summary", "terms"]);
  });

  it("corrects a saved template when it resolves", () => {
    const { blocks } = resolveTemplate("salesInvoice", {
      blocks: [
        { id: "lineItems", type: "lineItems", visible: true },
        { id: "note", type: "spacer", visible: true, variant: "space" },
        { id: "summary", type: "summary", visible: true }
      ]
    });
    const types = blocks.map((block) => block.type);
    expect(types.indexOf("summary")).toBe(types.indexOf("lineItems") + 1);
  });
});
