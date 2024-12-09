export const getCurrencyFormatter = (
  baseCurrencyCode: string,
  locale: string,
  maximumFractionDigits?: number
) => {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: baseCurrencyCode,
    maximumFractionDigits: maximumFractionDigits ?? 2,
  });
};
