import { getQuoteDisplayId } from "../../../utils/quote";
import type { QuoteData } from "./types";

/** Merge-field variable map for a Quote. */
export function buildQuoteVars(
  data: Pick<
    QuoteData,
    "quote" | "quoteCustomerDetails" | "company" | "currencyCode"
  >
): Record<string, string> {
  const q = data.quote;
  const c = data.quoteCustomerDetails;
  const str = (v: unknown): string => (v == null ? "" : String(v));

  return {
    "quote.number": q ? getQuoteDisplayId(q) : "",
    "quote.revision": str(q?.revisionId ?? 0),
    "quote.expirationDate": str(q?.expirationDate),
    "quote.customerReference": str(q?.customerReference),
    "quote.currency": str(data.currencyCode),
    "customer.name": str(c?.customerName),
    "customer.addressLine1": str(c?.customerAddressLine1),
    "customer.city": str(c?.customerCity),
    "customer.country": str(c?.customerCountryName),
    "company.name": str(data.company?.name),
    "company.city": str(data.company?.city),
    "company.country": str(data.company?.countryCode),
    "company.taxId": str(data.company?.taxId),
    "company.eori": str(data.company?.eori),
    "company.vatNumber": str(data.company?.vatNumber),
    "company.registrationNumber": str(data.company?.registrationNumber)
  };
}
