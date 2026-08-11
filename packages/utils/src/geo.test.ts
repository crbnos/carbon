import { describe, expect, it } from "vitest";
import { getTimezoneAbbreviations, getTimezones, isValidTimeZone } from "./geo";

describe("getTimezoneAbbreviations", () => {
  it("returns the colloquial abbreviations people search by", () => {
    // US zones: both standard and daylight from Intl's short names.
    expect(getTimezoneAbbreviations("America/Chicago")).toEqual(["CST", "CDT"]);
    expect(getTimezoneAbbreviations("America/New_York")).toEqual([
      "EST",
      "EDT"
    ]);
    // Zones where en-US short is a GMT offset: derived from the long name's
    // initials — the user-facing point of the feature.
    expect(getTimezoneAbbreviations("Asia/Calcutta")).toEqual(["IST"]);
    expect(getTimezoneAbbreviations("Asia/Tokyo")).toEqual(["JST"]);
    // The generic (qualifier-stripped) form is included so "CET" finds
    // Berlin/Paris even though the long names give CEST.
    expect(getTimezoneAbbreviations("Europe/Berlin")).toContain("CET");
    expect(getTimezoneAbbreviations("Australia/Sydney")).toContain("AEST");
    expect(getTimezoneAbbreviations("Europe/London")).toEqual(["GMT", "BST"]);
    expect(getTimezoneAbbreviations("UTC")).toEqual(["UTC"]);
  });

  it("returns [] for unresolvable zones instead of throwing", () => {
    expect(getTimezoneAbbreviations("Fake/Zone")).toEqual([]);
  });
});

describe("getTimezones", () => {
  it("labels read '(abbreviations, ±HH:MM)' — no redundant UTC prefix", () => {
    const all = getTimezones().flatMap((g) => g.options);
    const chicago = all.find((o) => o.value === "America/Chicago");
    expect(chicago?.label).toMatch(/\(CST\/CDT, [+-]\d{2}:\d{2}\)$/);
    expect(chicago?.label).not.toContain("UTC");
    const kolkata = all.find(
      (o) => o.value === "Asia/Calcutta" || o.value === "Asia/Kolkata"
    );
    expect(kolkata?.label).toContain("IST");
  });

  it("drops an abbreviation identical to the zone name (UTC, GMT)", () => {
    const all = getTimezones().flatMap((g) => g.options);
    const utc = all.find((o) => o.value === "UTC");
    // "UTC (+00:00)", not "UTC (UTC, +00:00)"
    expect(utc?.label).toBe("UTC (+00:00)");
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names and rejects garbage", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Fake/Zone")).toBe(false);
  });
});
