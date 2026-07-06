/**
 * Compose the per-page registration line shown on the left side of the PDF
 * footer (across PO, Quote, Sales Order, Sales Invoice).
 *
 * Format: "{companyName} is registered in {country}, Company Number {eori}".
 *   - The "Company Number {eori}" suffix is appended only when an EORI exists.
 *   - The "Accounts Receivable: {email}" suffix is appended only when provided
 *     (sales PDFs pass this; PO does not).
 *
 * Returns null when the minimum data (name + country) is missing — callers can
 * skip rendering when null.
 */
export function composeRegistrationLine({
  companyName,
  country,
  eori
}: {
  companyName: string | null | undefined;
  country: string | null | undefined;
  eori?: string | null;
}): string | null {
  if (!companyName || !country) return null;
  let line = `${companyName} is registered in ${country}`;
  if (eori) line += `, Company Registration Number ${eori}`;
  return line;
}
