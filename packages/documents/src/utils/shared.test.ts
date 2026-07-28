import { describe, expect, it } from "vitest";
import type { ResolvedSection, SectionConfig } from "../template";
import { getRegistrationFooter, resolveRegistrationLine } from "./shared";

const FOOTER_ID = "system-footer";

const footer = (config: SectionConfig): Record<string, ResolvedSection> => ({
  [FOOTER_ID]: {
    id: FOOTER_ID,
    name: "Default Footer",
    placement: "footer",
    content: { type: "doc", content: [] },
    config
  }
});

const VARS = {
  "company.taxId": "12-3456789",
  "company.registrationNumber": "09876543",
  "company.vatNumber": "GB123456789"
};

const VARS_WITHOUT_REGISTRATION = {
  ...VARS,
  "company.registrationNumber": ""
};

const company = { name: "Acme Ltd", countryCode: "GB" };

const resolve = (
  sections: Record<string, ResolvedSection>,
  vars: Record<string, string>,
  footerSectionId: string | null = FOOTER_ID,
  settings = { showRegistrationLine: true }
) =>
  resolveRegistrationLine({
    company,
    footerSectionId,
    sections,
    settings,
    vars
  });

describe("getRegistrationFooter", () => {
  it("drops the suffix when the number resolves empty", () => {
    expect(getRegistrationFooter("Acme Ltd", "GB", "")).toBe(
      "Acme Ltd is registered in United Kingdom"
    );
  });

  it("renders nothing without a company name", () => {
    expect(getRegistrationFooter(null, "GB", "09876543")).toBeUndefined();
  });
});

describe("resolveRegistrationLine", () => {
  it("defaults to the company registration number", () => {
    expect(resolve({}, VARS, null).label).toBe(
      "Acme Ltd is registered in United Kingdom, Company Registration Number 09876543"
    );
    expect(resolve(footer({ showRegistrationLine: true }), VARS).label).toBe(
      "Acme Ltd is registered in United Kingdom, Company Registration Number 09876543"
    );
  });

  it("prints no number when the company has no registration number", () => {
    expect(resolve({}, VARS_WITHOUT_REGISTRATION, null).label).toBe(
      "Acme Ltd is registered in United Kingdom"
    );
  });

  it("keeps an explicitly emptied registration number empty", () => {
    expect(
      resolve(
        footer({ showRegistrationLine: true, registrationNumber: "" }),
        VARS
      ).label
    ).toBe("Acme Ltd is registered in United Kingdom");
  });

  it("interpolates a configured value's merge fields", () => {
    expect(
      resolve(
        footer({
          showRegistrationLine: true,
          registrationNumber: "VAT {company.vatNumber}"
        }),
        VARS
      ).label
    ).toBe(
      "Acme Ltd is registered in United Kingdom, Company Registration Number VAT GB123456789"
    );
  });

  it("honors a footer configured to the tax id", () => {
    expect(
      resolve(
        footer({
          showRegistrationLine: true,
          registrationNumber: "{company.taxId}"
        }),
        VARS
      ).label
    ).toBe(
      "Acme Ltd is registered in United Kingdom, Company Registration Number 12-3456789"
    );
  });

  it("lets the footer config override the per-template visibility setting", () => {
    expect(
      resolve(footer({ showRegistrationLine: false }), VARS, FOOTER_ID, {
        showRegistrationLine: true
      }).show
    ).toBe(false);
    expect(
      resolve(footer({ showRegistrationLine: true }), VARS, FOOTER_ID, {
        showRegistrationLine: false
      }).show
    ).toBe(true);
  });

  it("falls back to the per-template setting without a footer config", () => {
    expect(resolve({}, VARS, null, { showRegistrationLine: false }).show).toBe(
      false
    );
    expect(resolve({}, VARS, null, { showRegistrationLine: true }).show).toBe(
      true
    );
  });
});
