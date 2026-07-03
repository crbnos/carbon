import { describe, expect, it } from "vitest";
import {
  ADDABLE_BLOCK_TYPES,
  BLOCK_META,
  DEFAULT_SALES_INVOICE_TEMPLATE,
  documentThemeColors,
  resolveTemplate
} from "./defaults";
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
      { id: "summary", type: "summary" as const, visible: true },
      { id: "lineItems", type: "lineItems" as const, visible: true },
      { id: "header", type: "header" as const, visible: false },
      { id: "parties", type: "parties" as const, visible: true },
      { id: "notes", type: "notes" as const, visible: true },
      { id: "terms", type: "terms" as const, visible: true }
    ];
    const { blocks } = resolveTemplate("salesInvoice", { blocks: stored });
    expect(blocks.map((b) => b.type)).toEqual([
      "summary",
      "lineItems",
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
});

describe("block metadata invariants", () => {
  it("keeps line items and summary non-hideable and non-removable", () => {
    for (const type of ["lineItems", "summary"] as const) {
      expect(BLOCK_META[type].hideable).toBe(false);
      expect(BLOCK_META[type].removable).toBe(false);
    }
  });

  it("only exposes extension blocks in the add menu", () => {
    expect(ADDABLE_BLOCK_TYPES).toEqual(["richText", "keyValue", "spacer"]);
    for (const type of ADDABLE_BLOCK_TYPES) {
      expect(BLOCK_META[type].isBuiltIn).toBe(false);
      expect(BLOCK_META[type].removable).toBe(true);
    }
  });
});

describe("document settings", () => {
  it("includes default settings on the default template", () => {
    expect(DEFAULT_SALES_INVOICE_TEMPLATE.settings).toEqual({
      fontFamily: "Inter",
      showPageNumbers: true,
      pageNumberFormat: "pageOfTotal",
      showRegistrationLine: true
    });
  });

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

  it("rejects unknown block types", () => {
    expect(() => blockSchema.parse({ id: "x", type: "bogus" })).toThrow();
  });

  it("validates a full template document", () => {
    const parsed = documentTemplateSchema.parse(DEFAULT_SALES_INVOICE_TEMPLATE);
    expect(parsed.blocks).toHaveLength(7);
  });
});
