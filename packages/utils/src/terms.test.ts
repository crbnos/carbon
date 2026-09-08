import { describe, expect, it } from "vitest";
import type { TermsVersionRow } from "./terms";
import { resolveEffectiveTermsVersion } from "./terms";

function row(
  overrides: Partial<TermsVersionRow> & { id: string }
): TermsVersionRow {
  return {
    content: { type: "doc", content: [] },
    partyIds: null,
    countryCodes: null,
    effectiveFrom: null,
    effectiveTo: null,
    ...overrides
  };
}

describe("resolveEffectiveTermsVersion", () => {
  it("prefers country over global on the same date", () => {
    const rows = [
      row({ id: "global" }),
      row({ id: "de", countryCodes: ["DE"] })
    ];
    expect(
      resolveEffectiveTermsVersion(rows, { countryCode: "DE" }, "2026-09-01")
        ?.id
    ).toBe("de");
  });

  it("never returns a row scoped to a different country", () => {
    const usOnly = [row({ id: "us", countryCodes: ["US"] })];
    expect(
      resolveEffectiveTermsVersion(usOnly, { countryCode: "DE" }, "2026-09-01")
    ).toBeNull();

    const withGlobal = [
      row({ id: "us", countryCodes: ["US"] }),
      row({ id: "global" })
    ];
    expect(
      resolveEffectiveTermsVersion(
        withGlobal,
        { countryCode: "DE" },
        "2026-09-01"
      )?.id
    ).toBe("global");
  });

  it("matches any country in a multi-country row", () => {
    const rows = [
      row({ id: "global" }),
      row({ id: "dach", countryCodes: ["DE", "AT", "CH"] })
    ];
    expect(
      resolveEffectiveTermsVersion(rows, { countryCode: "AT" }, "2026-09-01")
        ?.id
    ).toBe("dach");
    expect(
      resolveEffectiveTermsVersion(rows, { countryCode: "ch" }, "2026-09-01")
        ?.id
    ).toBe("dach");
    expect(
      resolveEffectiveTermsVersion(rows, { countryCode: "FR" }, "2026-09-01")
        ?.id
    ).toBe("global");
  });

  it("prefers a named counterparty over country and global", () => {
    const rows = [
      row({ id: "global" }),
      row({ id: "de", countryCodes: ["DE"] }),
      row({ id: "acme", partyIds: ["cust_acme", "cust_globex"] })
    ];
    const scope = { partyId: "cust_acme", countryCode: "DE" };
    expect(resolveEffectiveTermsVersion(rows, scope, "2026-09-01")?.id).toBe(
      "acme"
    );
    // A different counterparty in the same country falls to the country tier.
    expect(
      resolveEffectiveTermsVersion(
        rows,
        { partyId: "cust_other", countryCode: "DE" },
        "2026-09-01"
      )?.id
    ).toBe("de");
  });

  it("never returns a row scoped to a different counterparty", () => {
    const partyOnly = [row({ id: "acme", partyIds: ["cust_acme"] })];
    expect(
      resolveEffectiveTermsVersion(
        partyOnly,
        { partyId: "cust_other", countryCode: "DE" },
        "2026-09-01"
      )
    ).toBeNull();
    expect(
      resolveEffectiveTermsVersion(
        partyOnly,
        { countryCode: "DE" },
        "2026-09-01"
      )
    ).toBeNull();
  });

  it("selects by date window across a planned changeover", () => {
    const rows = [
      row({ id: "v1", effectiveTo: "2026-08-31" }),
      row({ id: "v2", effectiveFrom: "2026-09-01" })
    ];
    expect(
      resolveEffectiveTermsVersion(rows, { countryCode: null }, "2026-08-30")
        ?.id
    ).toBe("v1");
    expect(
      resolveEffectiveTermsVersion(rows, { countryCode: null }, "2026-09-01")
        ?.id
    ).toBe("v2");
  });

  it("falls back quietly to an expired version with no successor", () => {
    const rows = [
      row({ id: "v1", effectiveFrom: "2026-01-01", effectiveTo: "2026-08-31" })
    ];
    expect(
      resolveEffectiveTermsVersion(rows, { countryCode: null }, "2026-09-05")
        ?.id
    ).toBe("v1");
  });

  it("falls back quietly to a future-only version", () => {
    const rows = [row({ id: "v2", effectiveFrom: "2027-01-01" })];
    expect(
      resolveEffectiveTermsVersion(rows, { countryCode: null }, "2026-09-05")
        ?.id
    ).toBe("v2");
  });

  it("breaks same-tier ties by latest effectiveFrom, nulls oldest", () => {
    const rows = [
      row({ id: "old", effectiveFrom: null }),
      row({ id: "newer", effectiveFrom: "2026-06-01" })
    ];
    expect(
      resolveEffectiveTermsVersion(rows, { countryCode: null }, "2026-09-01")
        ?.id
    ).toBe("newer");
  });

  it("resolves only global rows when countryCode is null", () => {
    const rows = [
      row({ id: "de", countryCodes: ["DE"] }),
      row({ id: "global" })
    ];
    expect(
      resolveEffectiveTermsVersion(rows, { countryCode: null }, "2026-09-01")
        ?.id
    ).toBe("global");
    expect(
      resolveEffectiveTermsVersion(
        [row({ id: "de", countryCodes: ["DE"] })],
        { countryCode: null },
        "2026-09-01"
      )
    ).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(
      resolveEffectiveTermsVersion([], { countryCode: "DE" }, "2026-09-01")
    ).toBeNull();
  });

  it("prefers an in-window global over an out-of-window country match", () => {
    // Pass A only considers in-window rows; the expired DE row must not win
    // while a live global exists.
    const rows = [
      row({
        id: "de-expired",
        countryCodes: ["DE"],
        effectiveTo: "2026-01-31"
      }),
      row({ id: "global" })
    ];
    expect(
      resolveEffectiveTermsVersion(rows, { countryCode: "DE" }, "2026-09-01")
        ?.id
    ).toBe("global");
  });
});
