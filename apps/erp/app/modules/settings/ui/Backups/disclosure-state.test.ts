import { describe, expect, it } from "vitest";
import type { CompanyBackupSummary } from "../../backups.service";
import { CONFIRM_WORD, disclosureState } from "./disclosure-state";

type Finding = NonNullable<
  CompanyBackupSummary["compatibility"]
>["findings"][number];

const finding = (kind: Finding["kind"], table = "job"): Finding =>
  ({ kind, table, column: "startDate", reason: "a reason" }) as Finding;

const backup = (findings: Finding[] = []): CompanyBackupSummary =>
  ({
    name: "minimal",
    label: "minimal",
    exportedAt: "2026-08-25T20:06:00.000Z",
    compatibility: { findings }
  }) as unknown as CompanyBackupSummary;

// The states the disclosure screen can be in. Named here the way they are
// described to a reader, so a future change that collapses two of them fails.
describe("disclosureState", () => {
  it("a clean backup asks for nothing", () => {
    expect(disclosureState(backup(), "")).toEqual({
      unchecked: false,
      blocked: false,
      discards: false,
      canConfirm: true
    });
  });

  it("a listed backup whose verdict could not be computed is unchecked", () => {
    // Schema unreadable (DB down / pool exhausted) — the loader leaves
    // `compatibility` null rather than claiming the backup is clean.
    const unverified = {
      ...backup(),
      compatibility: null
    } as CompanyBackupSummary;
    expect(disclosureState(unverified, "")).toEqual({
      unchecked: true,
      blocked: false,
      discards: false,
      canConfirm: true
    });
  });

  it("an uploaded backup has no verdict, and still confirms", () => {
    expect(disclosureState(undefined, "")).toEqual({
      unchecked: true,
      blocked: false,
      discards: false,
      canConfirm: true
    });
  });

  it("a default-only finding is information, not a gate", () => {
    const state = disclosureState(backup([finding("defaulted")]), "");
    expect(state.discards).toBe(false);
    expect(state.canConfirm).toBe(true);
  });

  it("a discarded finding requires the typed word", () => {
    const b = backup([finding("discarded")]);
    expect(disclosureState(b, "").canConfirm).toBe(false);
    expect(disclosureState(b, CONFIRM_WORD).canConfirm).toBe(true);
  });

  it("a blocked finding can never be confirmed, typed word or not", () => {
    const b = backup([finding("blocked")]);
    expect(disclosureState(b, "").blocked).toBe(true);
    expect(disclosureState(b, CONFIRM_WORD).canConfirm).toBe(false);
  });

  it("mixed findings take the strictest one", () => {
    const b = backup([
      finding("defaulted"),
      finding("discarded", "salesOrder")
    ]);
    expect(disclosureState(b, "").discards).toBe(true);
    expect(disclosureState(b, CONFIRM_WORD).canConfirm).toBe(true);
  });
});

describe("the typed word", () => {
  const b = backup([finding("discarded")]);

  it("ignores case and surrounding space", () => {
    expect(disclosureState(b, "  ReStOrE ").canConfirm).toBe(true);
  });

  it("rejects a near miss", () => {
    expect(disclosureState(b, "restor").canConfirm).toBe(false);
    expect(disclosureState(b, "restore now").canConfirm).toBe(false);
  });
});
