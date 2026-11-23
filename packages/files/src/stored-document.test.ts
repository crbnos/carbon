// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { isStoredDocumentPdf, storedDocumentPdfName } from "./stored-document";

describe("storedDocumentPdfName", () => {
  it("names a stored PDF by display id and the UTC second", () => {
    expect(
      storedDocumentPdfName("PO000148-1", "2026-10-22T14:03:22.123Z")
    ).toBe("PO000148-1 - 2026-10-22T14:03:22.pdf");
  });

  it("drops characters a storage key cannot hold", () => {
    expect(storedDocumentPdfName("SO#12?", "2026-10-22T14:03:22.123Z")).toBe(
      "SO12 - 2026-10-22T14:03:22.pdf"
    );
  });
});

describe("isStoredDocumentPdf", () => {
  // Two orders converted from one supplier quote share the interaction folder.
  const orders = ["PO000146", "PO000148"];
  const stored = (displayId: string) =>
    storedDocumentPdfName(displayId, "2026-10-22T14:03:22.123Z");

  it("matches every document's stored PDF, at any revision", () => {
    expect(isStoredDocumentPdf(stored("PO000146"), orders)).toBe(true);
    expect(isStoredDocumentPdf(stored("PO000148"), orders)).toBe(true);
    expect(isStoredDocumentPdf(stored("PO000148-2"), orders)).toBe(true);
  });

  it("keeps the files a person added", () => {
    for (const name of [
      "drawing.pdf",
      "PO000148 notes.pdf",
      "PO000148 - signed copy.pdf",
      "PO000148 - 2026-10-22T14:03:22.step"
    ]) {
      expect(isStoredDocumentPdf(name, orders)).toBe(false);
    }
  });

  it("leaves another document's PDF alone when only the id prefix matches", () => {
    expect(isStoredDocumentPdf(stored("PO0001480"), orders)).toBe(false);
    expect(isStoredDocumentPdf(stored("PO000146"), ["PO00014"])).toBe(false);
  });

  it("matches nothing without document ids", () => {
    expect(isStoredDocumentPdf(stored("PO000146"), [])).toBe(false);
    expect(isStoredDocumentPdf(stored("PO000146"), [""])).toBe(false);
  });
});
