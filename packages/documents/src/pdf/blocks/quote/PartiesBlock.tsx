import { formatDate, isEoriCountry, pluralize } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Text, View } from "@react-pdf/renderer";
import { AddressBlock } from "../../components";
import { useTw } from "../tw";
import type { QuoteData } from "./types";

export function PartiesBlock({ data }: { data: QuoteData }) {
  const tw = useTw();
  const {
    quote,
    quoteCustomerDetails,
    payment,
    paymentTerms,
    shipment,
    maxLeadTime,
    locale
  } = data;
  const {
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerStateProvince,
    customerPostalCode,
    customerCountryCode,
    customerCountryName,
    customerTaxId,
    customerVatNumber,
    customerEori,
    contactName,
    contactEmail
  } = quoteCustomerDetails;

  const paymentTerm = paymentTerms?.find(
    (pt) => pt.id === payment?.paymentTermId
  );

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        {/* LEFT — To (customer) */}
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            To
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            <AddressBlock
              name={customerName}
              addressLine1={customerAddressLine1}
              addressLine2={customerAddressLine2}
              city={customerCity}
              stateProvince={customerStateProvince}
              postalCode={customerPostalCode}
              country={customerCountryName ?? customerCountryCode}
            />
            {customerTaxId && !isEoriCountry(customerCountryCode) && (
              <Text>Tax ID: {customerTaxId}</Text>
            )}
            {customerVatNumber && <Text>VAT: {customerVatNumber}</Text>}
            {customerEori && <Text>EORI: {customerEori}</Text>}
            {contactName && <Text>Contact: {contactName}</Text>}
            {contactEmail && <Text>Email: {contactEmail}</Text>}
          </View>
        </View>

        {/* RIGHT — Quote Details */}
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            Quote Details
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            <Text>
              Date:{" "}
              {formatDate(
                today(getLocalTimeZone()).toString(),
                undefined,
                locale
              )}
            </Text>
            {quote.expirationDate && (
              <Text style={tw("font-bold")}>
                Expires: {formatDate(quote.expirationDate, undefined, locale)}
              </Text>
            )}
            {quote.customerReference && (
              <Text>Reference: {quote.customerReference}</Text>
            )}
            {maxLeadTime > 0 && (
              <Text>
                Max Lead Time: {maxLeadTime} {pluralize(maxLeadTime, "day")}
              </Text>
            )}
            {paymentTerm && <Text>Payment Terms: {paymentTerm.name}</Text>}
            {shipment?.incoterm && (
              <Text>
                Incoterm: {shipment.incoterm}
                {shipment.incotermLocation
                  ? ` — ${shipment.incotermLocation}`
                  : ""}
              </Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
