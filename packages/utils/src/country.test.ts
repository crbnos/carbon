import { describe, expect, it } from "vitest";
import {
  COUNTRY_MAP,
  getCountryProfile,
  isEoriCountry,
  isRegistrationNumberCountry
} from "./country";

// The pre-refactor COUNTRY_PROFILES behavior: eori = EU-27 + GB,
// registrationNumber = GB only. The derived map must reproduce it exactly.
const EU_27 = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE"
];

describe("COUNTRY_MAP", () => {
  it("matches the country table seed's row count", () => {
    expect(Object.keys(COUNTRY_MAP)).toHaveLength(194);
  });

  it("has a name and 3-char alpha3 on every entry", () => {
    for (const [alpha2, entry] of Object.entries(COUNTRY_MAP)) {
      expect(alpha2).toMatch(/^[A-Z]{2}$/);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.alpha3).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("derives exactly the pre-refactor eori set (EU-27 + GB)", () => {
    const eoriCountries = Object.entries(COUNTRY_MAP)
      .filter(([, entry]) => entry.eori)
      .map(([code]) => code)
      .sort();
    expect(eoriCountries).toEqual([...EU_27, "GB"].sort());
  });

  it("derives exactly the pre-refactor registrationNumber set (GB)", () => {
    const registrationCountries = Object.entries(COUNTRY_MAP)
      .filter(([, entry]) => entry.registrationNumber)
      .map(([code]) => code);
    expect(registrationCountries).toEqual(["GB"]);
  });
});

describe("profile helpers (behavior parity with the old COUNTRY_PROFILES)", () => {
  it("keeps eori answers unchanged", () => {
    expect(isEoriCountry("FR")).toBe(true);
    expect(isEoriCountry("GB")).toBe(true);
    expect(isEoriCountry("US")).toBe(false);
    expect(isEoriCountry(null)).toBe(false);
  });

  it("keeps registrationNumber answers unchanged", () => {
    expect(isRegistrationNumberCountry("GB")).toBe(true);
    expect(isRegistrationNumberCountry("DE")).toBe(false);
  });

  it("returns undefined for countries with no profile facts, like before", () => {
    expect(getCountryProfile("US")).toBeUndefined();
    expect(getCountryProfile(undefined)).toBeUndefined();
    expect(getCountryProfile("gb")).toEqual({
      eori: true,
      registrationNumber: true
    });
  });
});
