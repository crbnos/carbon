import { describe, expect, it } from "vitest";
import {
  sumQboJournalEntryDebitTotals,
  sumRilletJournalEntryDebitTotals,
  sumXeroManualJournalDebitTotals
} from "./remote-journal";

// The tie-out compares Carbon's debit-signed per-account sums against what
// the provider actually stored, so each reducer must return NET debit-signed
// totals per remote account ref: debits positive, credits negative, refs
// with equal debits and credits netting to zero (not dropped — a zero net is
// still information).

describe("sumXeroManualJournalDebitTotals", () => {
  it("nets debit-signed LineAmounts per AccountCode", () => {
    const totals = sumXeroManualJournalDebitTotals({
      JournalLines: [
        { AccountCode: "1200", LineAmount: 150.25 },
        { AccountCode: "1200", LineAmount: 49.75 },
        { AccountCode: "4000", LineAmount: -200 }
      ]
    });

    expect(totals.get("1200")).toBe(200);
    expect(totals.get("4000")).toBe(-200);
    expect(totals.size).toBe(2);
  });

  it("handles a journal with no lines", () => {
    expect(sumXeroManualJournalDebitTotals({}).size).toBe(0);
    expect(sumXeroManualJournalDebitTotals({ JournalLines: [] }).size).toBe(0);
  });

  it("sums in cents so 2-dp amounts carry no float residue", () => {
    const totals = sumXeroManualJournalDebitTotals({
      JournalLines: [
        { AccountCode: "1200", LineAmount: 0.1 },
        { AccountCode: "1200", LineAmount: 0.2 }
      ]
    });

    expect(totals.get("1200")).toBe(0.3);
  });
});

describe("sumRilletJournalEntryDebitTotals", () => {
  it("parses 2-dp string amounts, DEBIT adds and CREDIT subtracts, keyed by account_code", () => {
    const totals = sumRilletJournalEntryDebitTotals({
      items: [
        {
          account_code: "1200",
          amount: { amount: "150.25", currency: "USD" },
          side: "DEBIT"
        },
        {
          account_code: "1200",
          amount: { amount: "50.25", currency: "USD" },
          side: "CREDIT"
        },
        {
          account_code: "4000",
          amount: { amount: "100.00", currency: "USD" },
          side: "CREDIT"
        }
      ]
    });

    expect(totals.get("1200")).toBe(100);
    expect(totals.get("4000")).toBe(-100);
    expect(totals.size).toBe(2);
  });

  it("nets a balanced ref to zero instead of dropping it", () => {
    const totals = sumRilletJournalEntryDebitTotals({
      items: [
        {
          account_code: "1200",
          amount: { amount: "75.00", currency: "USD" },
          side: "DEBIT"
        },
        {
          account_code: "1200",
          amount: { amount: "75.00", currency: "USD" },
          side: "CREDIT"
        }
      ]
    });

    expect(totals.get("1200")).toBe(0);
  });
});

describe("sumQboJournalEntryDebitTotals", () => {
  it("applies PostingType to always-positive Amounts, keyed by AccountRef.value", () => {
    const totals = sumQboJournalEntryDebitTotals({
      Line: [
        {
          Amount: 150.25,
          DetailType: "JournalEntryLineDetail",
          JournalEntryLineDetail: {
            PostingType: "Debit",
            AccountRef: { value: "72" }
          }
        },
        {
          Amount: 50.25,
          DetailType: "JournalEntryLineDetail",
          JournalEntryLineDetail: {
            PostingType: "Credit",
            AccountRef: { value: "72" }
          }
        },
        {
          Amount: 100,
          DetailType: "JournalEntryLineDetail",
          JournalEntryLineDetail: {
            PostingType: "Credit",
            AccountRef: { value: "81" }
          }
        }
      ]
    });

    expect(totals.get("72")).toBe(100);
    expect(totals.get("81")).toBe(-100);
    expect(totals.size).toBe(2);
  });

  it("handles an entry with no lines", () => {
    expect(sumQboJournalEntryDebitTotals({ Line: [] }).size).toBe(0);
  });
});
