import {
  DEFAULT_CURRENCY_DECIMALS,
  formatPercent,
  moneyFormatOptions,
  SCALE
} from "@carbon/utils";
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
  taxPercent: number | null | undefined,
  locale: string
): string | null => {
  if (!taxPercent) return null;
  return formatPercent(taxPercent, locale);
};

/** Money for documents. `currency` decides only whether the SYMBOL renders:
 *  pass it for emails ("$300.00"), omit it for the PDF amount columns, which
 *  print the currency code separately ("300.00"). The digits are the same
 *  question either way and come from the currency row. */
export const getMoneyFormatter = (
  locale: string,
  decimalPlaces?: number | null,
  currency?: string | null
) =>
  new Intl.NumberFormat(
    locale,
    moneyFormatOptions(decimalPlaces ?? DEFAULT_CURRENCY_DECIMALS, {
      currency: currency ?? undefined
    })
  );

/** A per-unit RATE for documents — same padding as getMoneyFormatter, but the
 *  currency's decimals are a FLOOR, not a ceiling: a printed $0.164 unit price
 *  stays $0.164 instead of rounding to $0.16. Use for a unit-price COLUMN;
 *  totals, tax, and shipping on the same document stay on getMoneyFormatter,
 *  since those are settlement amounts, not rates. */
export const getRateFormatter = (
  locale: string,
  decimalPlaces?: number | null,
  currency?: string | null
) =>
  new Intl.NumberFormat(
    locale,
    moneyFormatOptions(decimalPlaces ?? DEFAULT_CURRENCY_DECIMALS, {
      currency: currency ?? undefined,
      maxDecimalPlaces: SCALE
    })
  );
