/**
 * Compose the per-page registration line shown on the left side of the PDF
 * footer (across PO, Quote, Sales Order, Sales Invoice).
 *
 * Format: "{companyName} is registered in {country}, Company Registration
 * Number {registrationNumber}".
 *   - The "Company Registration Number {registrationNumber}" suffix is appended
 *     only when a registration number is provided. Callers pass the template's
 *     free-text `settings.registrationNumber`, already resolved through
 *     `interpolateString` (so `{company.taxId}` etc. are filled in).
 *
 * Returns null when the minimum data (name + country) is missing — callers can
 * skip rendering when null.
 */
export function composeRegistrationLine({
  companyName,
  country,
  registrationNumber
}: {
  companyName: string | null | undefined;
  country: string | null | undefined;
  registrationNumber?: string | null;
}): string | null {
  if (!companyName || !country) return null;
  let line = `${companyName} is registered in ${country}`;
  if (registrationNumber)
    line += `, Company Registration Number ${registrationNumber}`;
  return line;
}
