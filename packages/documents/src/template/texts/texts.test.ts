// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { TOKEN_RE } from "../merge";
import { getLineMergeFields, getMergeFields } from "../mergeFields";
import { makeText, TEXT_CATALOG } from "./index";
import type { TextEntry } from "./types";

const entries = [
  { key: "taxId", kind: "field", default: "Tax ID:" },
  { key: "total", kind: "text", default: "Total ({order.currency})" }
] as const satisfies readonly TextEntry[];

const vars = { "order.currency": "USD" };

describe("makeText", () => {
  it("prints the default when the user changed nothing", () => {
    expect(makeText(entries, undefined, vars)("taxId")).toBe("Tax ID:");
  });

  it("prints the user's text in place of the default", () => {
    const t = makeText(entries, { text: { taxId: "GST No.:" } }, vars);
    expect(t("taxId")).toBe("GST No.:");
  });

  it("prints nothing for a text the user emptied", () => {
    expect(makeText(entries, { text: { taxId: "" } }, vars)("taxId")).toBe("");
  });

  it("fills variables in defaults and in the user's text", () => {
    expect(makeText(entries, undefined, vars)("total")).toBe("Total (USD)");
    const t = makeText(
      entries,
      { text: { taxId: "{order.currency} ID" } },
      vars
    );
    expect(t("taxId")).toBe("USD ID");
  });

  it("hides only the keys the user hid", () => {
    const t = makeText(entries, { hidden: ["taxId"] }, vars);
    expect(t.shows("taxId")).toBe(false);
    expect(t.shows("total")).toBe(true);
  });
});

describe("makeText rows", () => {
  const rows = [
    { key: "date", kind: "field", default: "Date: {order.date}" },
    { key: "fixed", kind: "field", default: "Thank you" },
    { key: "qty", kind: "value", default: "{line.quantity} {line.unit}" }
  ] as const satisfies readonly TextEntry[];

  it("fills a table row's variables over the document's", () => {
    const t = makeText(rows, undefined, {});
    expect(t("qty", { "line.quantity": "10", "line.unit": "EA" })).toBe(
      "10 EA"
    );
  });

  it("prints no row when every variable in it is empty", () => {
    const t = makeText(rows, undefined, { "order.date": "" });
    expect(t.prints("date")).toBe(false);
    expect(t.prints("qty", { "line.quantity": "", "line.unit": "" })).toBe(
      false
    );
  });

  it("prints a row when one variable has a value, without stray spaces", () => {
    const t = makeText(rows, undefined, {});
    const row = { "line.quantity": "", "line.unit": "EA" };
    expect(t.prints("qty", row)).toBe(true);
    expect(t("qty", row)).toBe("EA");
  });

  it("prints a row of plain words, and not one the user hid or emptied", () => {
    expect(makeText(rows, undefined, {}).prints("fixed")).toBe(true);
    expect(makeText(rows, { hidden: ["fixed"] }, {}).prints("fixed")).toBe(
      false
    );
    expect(makeText(rows, { text: { fixed: "" } }, {}).prints("fixed")).toBe(
      false
    );
  });
});

describe("makeText values", () => {
  const owned = [
    { key: "customer", kind: "field", default: "Customer:" },
    { key: "customerValue", kind: "value", default: "{c}", of: "customer" }
  ] as const satisfies readonly TextEntry[];

  it("prints no value when the user hid the row it belongs to", () => {
    const vars = { c: "Globex" };
    expect(makeText(owned, undefined, vars).prints("customerValue")).toBe(true);
    expect(
      makeText(owned, { hidden: ["customer"] }, vars).prints("customerValue")
    ).toBe(false);
  });
});

describe("TEXT_CATALOG", () => {
  // A default is not a stored text, so nothing else checks it: a typo in one
  // prints an empty value, and `prints` then drops the row from every document.
  it("uses only variables the document offers", () => {
    for (const [documentType, catalog] of Object.entries(TEXT_CATALOG)) {
      const known = getMergeFields(documentType).map((f) => f.token);
      for (const [blockType, blockEntries] of Object.entries(catalog)) {
        for (const entry of (blockEntries ?? []) as readonly TextEntry[]) {
          const offered = [
            ...known,
            ...(entry.row
              ? getLineMergeFields(documentType, entry.row).map((f) => f.token)
              : [])
          ];
          for (const [, token] of entry.default.matchAll(TOKEN_RE)) {
            expect(
              offered,
              `${documentType}.${blockType}.${entry.key}`
            ).toContain(token);
          }
        }
      }
    }
  });

  it("links a value to a text of its block, and a row to its variables", () => {
    for (const [documentType, catalog] of Object.entries(TEXT_CATALOG)) {
      for (const [blockType, blockEntries] of Object.entries(catalog)) {
        const entries = (blockEntries ?? []) as readonly TextEntry[];
        const keys = entries.map((entry) => entry.key);
        for (const entry of entries) {
          const name = `${documentType}.${blockType}.${entry.key}`;
          if (entry.of) expect(keys, name).toContain(entry.of);
          if (entry.row) {
            expect(
              getLineMergeFields(documentType, entry.row).length,
              name
            ).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  // A duplicate key would make two printed texts share one stored value.
  it("has unique keys and a non-empty default in every block", () => {
    for (const [documentType, catalog] of Object.entries(TEXT_CATALOG)) {
      for (const [blockType, blockEntries] of Object.entries(catalog)) {
        const keys = (blockEntries ?? []).map((entry) => entry.key);
        expect(
          new Set(keys).size,
          `${documentType}.${blockType} has a duplicate key`
        ).toBe(keys.length);
        for (const entry of blockEntries ?? []) {
          expect(
            entry.default.length,
            `${documentType}.${blockType}.${entry.key}`
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});
