import type { ResolvedSection } from "../template";
import { DEFAULT_REGISTRATION_NUMBER, interpolateString } from "../template";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export const getCountryName = (
  countryCode: string | null | undefined
): string => {
  if (!countryCode) return "";
  try {
    return regionNames.of(countryCode.toUpperCase()) ?? countryCode;
  } catch {
    return countryCode;
  }
};

/**
 * Compose the per-page registration line shown on the left side of the PDF
 * footer: "{name} is registered in {country}, Company Registration Number
 * {registrationNumber}". Callers pass the footer section's free-text
 * `config.registrationNumber` already resolved through `interpolateString`
 * (so `{company.taxId}` etc. are filled in); the suffix is dropped when it
 * resolves empty. The country code is mapped to a display name ("GB" →
 * "United Kingdom").
 */
export const getRegistrationFooter = (
  name: string | null | undefined,
  countryCode: string | null | undefined,
  registrationNumber: string | null | undefined
): string | undefined => {
  if (!name) return undefined;
  const country = getCountryName(countryCode);
  const base = country ? `${name} is registered in ${country}` : name;
  return registrationNumber
    ? `${base}, Company Registration Number ${registrationNumber}`
    : base;
};

/**
 * Resolve the footer registration line for a document. The shared footer
 * section's config decides the text and visibility, so every document type
 * using that footer shares one setting; legacy templates without a configured
 * footer fall back to the per-template `settings.showRegistrationLine`.
 */
export const resolveRegistrationLine = ({
  company,
  footerSectionId,
  sections,
  settings,
  vars
}: {
  company: {
    name: string | null | undefined;
    countryCode: string | null | undefined;
  };
  footerSectionId: string | null;
  sections: Record<string, ResolvedSection>;
  settings: { showRegistrationLine: boolean };
  vars: Record<string, string>;
}): { label: string | undefined; show: boolean } => {
  const config = footerSectionId
    ? sections[footerSectionId]?.config
    : undefined;
  return {
    label: getRegistrationFooter(
      company.name,
      company.countryCode,
      interpolateString(
        config?.registrationNumber ?? DEFAULT_REGISTRATION_NUMBER,
        vars
      )
    ),
    show: config?.showRegistrationLine ?? settings.showRegistrationLine
  };
};

export const formatTaxPercent = (
  taxPercent: number | null | undefined
): string | null => {
  if (!taxPercent) return null;
  return `${(taxPercent * 100).toFixed(0)}%`;
};

export const getCurrencyFormatter = (
  baseCurrencyCode: string,
  locale: string,
  maximumFractionDigits?: number
) => {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: baseCurrencyCode,
    maximumFractionDigits: maximumFractionDigits ?? 2
  });
};
