import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  decodeCursor,
  encodeCursor,
  hashRequestBody,
  paginateByAccountNumber,
  toTrialBalanceRow,
  validateImportEntryBalance
} from "./accounting.integration";

describe("canonicalJson", () => {
  it("sorts object keys recursively so key order does not matter", () => {
    const a = { b: 1, a: { d: 2, c: 3 } };
    const b = { a: { c: 3, d: 2 }, b: 1 };
    expect(canonicalJson(a)).toEqual(canonicalJson(b));
  });

  it("preserves array order (arrays are ordered data)", () => {
    expect(canonicalJson([1, 2])).not.toEqual(canonicalJson([2, 1]));
  });
});

describe("hashRequestBody", () => {
  it("is stable across key reordering (idempotency fingerprint)", () => {
    const body1 = { entries: [{ externalId: "x", postingDate: "2026-06-30" }] };
    const body2 = { entries: [{ postingDate: "2026-06-30", externalId: "x" }] };
    expect(hashRequestBody(body1)).toEqual(hashRequestBody(body2));
  });

  it("changes when the body content changes", () => {
    const base = hashRequestBody({ amount: 100 });
    expect(hashRequestBody({ amount: 101 })).not.toEqual(base);
  });

  it("returns a 64-char hex sha256 digest", () => {
    expect(hashRequestBody({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("cursor round-trip", () => {
  it("encodes and decodes an account number", () => {
    expect(decodeCursor(encodeCursor("6200"))).toBe("6200");
  });

  it("returns null for empty/invalid cursors", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
});

describe("validateImportEntryBalance", () => {
  it("accepts a balanced entry", () => {
    const errors = validateImportEntryBalance({
      lines: [
        { accountNumber: "6200", debit: 41250, credit: 0 },
        { accountNumber: "3150", debit: 0, credit: 41250 }
      ]
    });
    expect(errors).toHaveLength(0);
  });

  it("rejects an unbalanced entry with a line-level error", () => {
    const errors = validateImportEntryBalance({
      lines: [
        { accountNumber: "6200", debit: 41250, credit: 0 },
        { accountNumber: "3150", debit: 0, credit: 40000 }
      ]
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe("lines");
    expect(errors[0].message).toMatch(/does not balance/);
  });

  it("tolerates sub-cent rounding (<= 0.001)", () => {
    const errors = validateImportEntryBalance({
      lines: [
        { accountNumber: "6200", debit: 100.0005, credit: 0 },
        { accountNumber: "3150", debit: 0, credit: 100 }
      ]
    });
    expect(errors).toHaveLength(0);
  });
});

describe("paginateByAccountNumber", () => {
  const rows = [
    { accountNumber: "3000" },
    { accountNumber: "1000" },
    { accountNumber: "2000" },
    { accountNumber: "4000" }
  ];

  it("sorts by accountNumber and honors limit + nextCursor", () => {
    const { page, nextCursor } = paginateByAccountNumber(rows, { limit: 2 });
    expect(page.map((r) => r.accountNumber)).toEqual(["1000", "2000"]);
    expect(decodeCursor(nextCursor)).toBe("2000");
  });

  it("resumes after the cursor", () => {
    const { page, nextCursor } = paginateByAccountNumber(rows, {
      cursor: encodeCursor("2000"),
      limit: 2
    });
    expect(page.map((r) => r.accountNumber)).toEqual(["3000", "4000"]);
    expect(nextCursor).toBeNull(); // last page
  });

  it("returns null cursor when everything fits on one page", () => {
    const { page, nextCursor } = paginateByAccountNumber(rows, { limit: 10 });
    expect(page).toHaveLength(4);
    expect(nextCursor).toBeNull();
  });
});

describe("toTrialBalanceRow", () => {
  it("keys the row by accountNumber and coerces numeric strings", () => {
    const row = toTrialBalanceRow(
      {
        accountId: "acc-1",
        accountNumber: "1000",
        accountName: "Cash",
        accountClass: "Asset",
        incomeBalance: "Balance Sheet",
        debitBalance: "1500.5000",
        creditBalance: null,
        netChange: "1500.5000"
      },
      "USD"
    );
    expect(row).toEqual({
      accountNumber: "1000",
      accountId: "acc-1",
      accountName: "Cash",
      class: "Asset",
      debits: 1500.5,
      credits: 0,
      netChange: 1500.5,
      currencyCode: "USD"
    });
  });
});
