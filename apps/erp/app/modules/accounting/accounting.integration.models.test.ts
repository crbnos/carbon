import { describe, expect, it, vi } from "vitest";

// @carbon/glossary evaluates Lingui `msg` macros at module load, which vitest
// doesn't transform. Nothing under test touches it — stub the whole package.
vi.mock("@carbon/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: () => [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: (t: string) => t,
  terms: {}
}));

import {
  journalEntryImportValidator,
  trialBalanceQueryValidator,
  webhookRegistrationValidator,
  webhookTopics
} from "./accounting.models";

describe("webhookRegistrationValidator", () => {
  it("accepts an https url with known topics", () => {
    const r = webhookRegistrationValidator.safeParse({
      url: "https://hooks.example.com/carbon",
      topics: ["journal_entry.posted", "period.closed"]
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-https url", () => {
    const r = webhookRegistrationValidator.safeParse({
      url: "http://hooks.example.com/carbon",
      topics: ["journal_entry.posted"]
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown topic", () => {
    const r = webhookRegistrationValidator.safeParse({
      url: "https://hooks.example.com/carbon",
      topics: ["journal_entry.exploded"]
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty topic list", () => {
    const r = webhookRegistrationValidator.safeParse({
      url: "https://hooks.example.com/carbon",
      topics: []
    });
    expect(r.success).toBe(false);
  });

  it("documents the v1 topic catalog", () => {
    expect(webhookTopics).toEqual([
      "journal_entry.posted",
      "journal_entry.reversed",
      "period.locked",
      "period.closed",
      "period.reopened",
      "approval.decided"
    ]);
  });
});

describe("trialBalanceQueryValidator", () => {
  it("accepts periodId alone", () => {
    const r = trialBalanceQueryValidator.safeParse({ periodId: "ap-1" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(500); // default
  });

  it("accepts a start/end date range", () => {
    const r = trialBalanceQueryValidator.safeParse({
      startDate: "2026-01-01",
      endDate: "2026-06-30"
    });
    expect(r.success).toBe(true);
  });

  it("rejects when neither period nor full range is given", () => {
    expect(
      trialBalanceQueryValidator.safeParse({ startDate: "2026-01-01" }).success
    ).toBe(false);
    expect(trialBalanceQueryValidator.safeParse({}).success).toBe(false);
  });

  it("coerces limit and caps it at 1000", () => {
    expect(
      trialBalanceQueryValidator.safeParse({ periodId: "ap-1", limit: "2000" })
        .success
    ).toBe(false);
    const ok = trialBalanceQueryValidator.safeParse({
      periodId: "ap-1",
      limit: "250"
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.limit).toBe(250);
  });
});

describe("journalEntryImportValidator", () => {
  const goodEntry = {
    externalId: "carta-sbc-2026-06",
    postingDate: "2026-06-30",
    lines: [
      { accountNumber: "6200", debit: 41250, credit: 0 },
      { accountNumber: "3150", debit: 0, credit: 41250 }
    ]
  };

  it("accepts a valid single-entry batch and defaults autoSubmit=true", () => {
    const r = journalEntryImportValidator.safeParse({ entries: [goodEntry] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.entries[0].autoSubmit).toBe(true);
  });

  it("rejects a line with both debit and credit", () => {
    const r = journalEntryImportValidator.safeParse({
      entries: [
        {
          postingDate: "2026-06-30",
          lines: [{ accountNumber: "6200", debit: 10, credit: 10 }]
        }
      ]
    });
    expect(r.success).toBe(false);
  });

  it("rejects a line with neither debit nor credit", () => {
    const r = journalEntryImportValidator.safeParse({
      entries: [
        {
          postingDate: "2026-06-30",
          lines: [{ accountNumber: "6200", debit: 0, credit: 0 }]
        }
      ]
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-ISO postingDate", () => {
    const r = journalEntryImportValidator.safeParse({
      entries: [{ ...goodEntry, postingDate: "06/30/2026" }]
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 100 entries", () => {
    const r = journalEntryImportValidator.safeParse({
      entries: Array.from({ length: 101 }, () => goodEntry)
    });
    expect(r.success).toBe(false);
  });

  it("rejects an entry with more than 500 lines", () => {
    const line = { accountNumber: "6200", debit: 1, credit: 0 };
    const r = journalEntryImportValidator.safeParse({
      entries: [
        {
          postingDate: "2026-06-30",
          lines: Array.from({ length: 501 }, () => line)
        }
      ]
    });
    expect(r.success).toBe(false);
  });
});
