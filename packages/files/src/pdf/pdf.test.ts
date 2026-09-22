import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractPdfPages,
  extractPdfText,
  getPdfMeta,
  getPdfPageCount
} from "./pdf";

const fixture = () => readFile(join(__dirname, "__fixtures__", "sample.pdf"));

describe("pdf reading", () => {
  it("counts pages", async () => {
    expect(await getPdfPageCount(await fixture())).toBe(2);
  });

  it("extracts per-page text", async () => {
    const pages = await extractPdfPages(await fixture());
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("INV-001");
    expect(pages[1]).toContain("PO-77");
  });

  it("joins pages with the separator the extraction prompts expect", async () => {
    const { text, pageCount } = await extractPdfText(await fixture());
    expect(pageCount).toBe(2);
    expect(text).toMatch(/^--- Page 1 ---\n.*INV-001/);
    expect(text).toContain("--- Page 2 ---\n");
  });

  it("reads metadata", async () => {
    const meta = await getPdfMeta(await fixture());
    expect(meta.Title).toBe("Carbon fixture");
  });
});
