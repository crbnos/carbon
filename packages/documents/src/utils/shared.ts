export const getCurrencyFormatter = (
  baseCurrencyCode: string,
  locale: string
) => {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: baseCurrencyCode,
    maximumFractionDigits: 4,
  });
};
