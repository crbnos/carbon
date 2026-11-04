// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate, isEoriCountry, pluralize } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Text, View } from "@react-pdf/renderer";
import { type DocumentBlock, makeText, quoteTexts } from "../../../template";
import { AddressBlock } from "../../components";
import { useTw } from "../tw";
import type { QuoteData } from "./types";

export function PartiesBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: QuoteData;
}) {
  const tw = useTw();
  const t = makeText(quoteTexts.parties, block, data.vars);
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
            {t("to")}
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
            {t.shows("taxId") &&
            customerTaxId &&
            !isEoriCountry(customerCountryCode) ? (
              <Text>
                {t("taxId")} {customerTaxId}
              </Text>
            ) : null}
            {t.shows("vat") && customerVatNumber ? (
              <Text>
                {t("vat")} {customerVatNumber}
              </Text>
            ) : null}
            {t.shows("eori") && customerEori ? (
              <Text>
                {t("eori")} {customerEori}
              </Text>
            ) : null}
            {t.shows("contact") && contactName ? (
              <Text>
                {t("contact")} {contactName}
              </Text>
            ) : null}
            {t.shows("email") && contactEmail ? (
              <Text>
                {t("email")} {contactEmail}
              </Text>
            ) : null}
          </View>
        </View>

        {/* RIGHT — Quote Details */}
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("quoteDetails")}
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            {t.shows("date") ? (
              <Text>
                {t("date")}{" "}
                {formatDate(
                  today(getLocalTimeZone()).toString(),
                  undefined,
                  locale
                )}
              </Text>
            ) : null}
            {t.shows("expires") && quote.expirationDate ? (
              <Text style={tw("font-bold")}>
                {t("expires")}{" "}
                {formatDate(quote.expirationDate, undefined, locale)}
              </Text>
            ) : null}
            {t.shows("reference") && quote.customerReference ? (
              <Text>
                {t("reference")} {quote.customerReference}
              </Text>
            ) : null}
            {t.shows("maxLeadTime") && maxLeadTime > 0 ? (
              <Text>
                {t("maxLeadTime")} {maxLeadTime} {pluralize(maxLeadTime, "day")}
              </Text>
            ) : null}
            {t.shows("paymentTerms") && paymentTerm ? (
              <Text>
                {t("paymentTerms")} {paymentTerm.name}
              </Text>
            ) : null}
            {t.shows("incoterm") && shipment?.incoterm ? (
              <Text>
                {t("incoterm")} {shipment.incoterm}
                {shipment.incotermLocation
                  ? ` — ${shipment.incotermLocation}`
                  : ""}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}
