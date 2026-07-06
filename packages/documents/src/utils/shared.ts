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

export const getRegistrationFooter = (
  name: string | null | undefined,
  countryCode: string | null | undefined,
  taxId: string | null | undefined
): string | undefined => {
  if (!name) return undefined;
  const country = getCountryName(countryCode);
  const base = country ? `${name} is registered in ${country}` : name;
  return taxId ? `${base}, Company Registration Number ${taxId}` : base;
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
