// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate, isEoriCountry } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  salesInvoiceTexts
} from "../../template";
import { AddressBlock } from "../components";
import { useTw } from "./tw";
import type { SalesInvoiceData } from "./types";

export function PartiesBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: SalesInvoiceData;
}) {
  const tw = useTw();
  const t = makeText(salesInvoiceTexts.parties, block, data.vars);
  const {
    salesInvoice,
    salesInvoiceShipment,
    salesInvoiceLocations,
    salesOrderIds,
    paymentTerms,
    shippingMethods,
    locale
  } = data;

  const {
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerStateProvince,
    customerPostalCode,
    customerCountryName,
    customerTaxId,
    customerVatNumber,
    customerEori,
    invoiceCustomerName,
    invoiceAddressLine1,
    invoiceAddressLine2,
    invoiceCity,
    invoiceStateProvince,
    invoicePostalCode,
    invoiceCountryName,
    shipmentCustomerName,
    shipmentAddressLine1,
    shipmentAddressLine2,
    shipmentCity,
    shipmentStateProvince,
    shipmentPostalCode,
    shipmentCountryName,
    contactName,
    contactEmail
  } = salesInvoiceLocations;

  const paymentTerm = paymentTerms?.find(
    (term) => term.id === salesInvoice?.paymentTermId
  );

  const shippingMethod = shippingMethods?.find(
    (method) => method.id === salesInvoiceShipment?.shippingMethodId
  );

  return (
    /* Body row — Bill To (left) | Invoice Details + Ship To stacked (right) */
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        {/* LEFT — Bill To (the customer being invoiced) */}
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("billTo")}
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            <AddressBlock
              name={invoiceCustomerName ?? customerName}
              addressLine1={invoiceAddressLine1 ?? customerAddressLine1}
              addressLine2={invoiceAddressLine2 ?? customerAddressLine2}
              city={invoiceCity ?? customerCity}
              stateProvince={invoiceStateProvince ?? customerStateProvince}
              postalCode={invoicePostalCode ?? customerPostalCode}
              country={invoiceCountryName ?? customerCountryName}
            />
            {t.shows("taxId") &&
            customerTaxId &&
            !isEoriCountry(invoiceCountryName ?? customerCountryName) ? (
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

        {/* RIGHT — Invoice Details + Ship To stacked */}
        <View style={tw("w-1/2 flex flex-col")}>
          {/* Invoice Details — Due Date prominent */}
          <View
            style={tw(
              shipmentCustomerName ? "p-3 border-b border-gray-200" : "p-3"
            )}
          >
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              {t("invoiceDetails")}
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              {t.shows("dateIssued") && salesInvoice?.dateIssued ? (
                <Text>
                  {t("dateIssued")}{" "}
                  {formatDate(salesInvoice.dateIssued, undefined, locale)}
                </Text>
              ) : null}
              {t.shows("dueDate") && salesInvoice?.dateDue ? (
                <Text style={tw("font-bold")}>
                  {t("dueDate")}{" "}
                  {formatDate(salesInvoice.dateDue, undefined, locale)}
                </Text>
              ) : null}
              {t.shows("customerRef") && salesInvoice?.customerReference ? (
                <Text>
                  {t("customerRef")} {salesInvoice.customerReference}
                </Text>
              ) : null}
              {t.shows("salesOrder") &&
              salesOrderIds &&
              salesOrderIds.length > 0 ? (
                <Text>
                  {salesOrderIds.length > 1
                    ? t("salesOrders")
                    : t("salesOrder")}{" "}
                  {salesOrderIds.join(", ")}
                </Text>
              ) : null}
              {t.shows("paymentTerms") && paymentTerm ? (
                <Text>
                  {t("paymentTerms")} {paymentTerm.name}
                </Text>
              ) : null}
              {t.shows("shipping") && shippingMethod ? (
                <Text>
                  {t("shipping")} {shippingMethod.name}
                </Text>
              ) : null}
              {t.shows("shippingTerms") &&
              salesInvoiceShipment?.shippingTermId ? (
                <Text>
                  {t("shippingTerms")} {salesInvoiceShipment.shippingTermId}
                </Text>
              ) : null}
              {t.shows("incoterm") && salesInvoiceShipment?.incoterm ? (
                <Text>
                  {t("incoterm")} {salesInvoiceShipment.incoterm}
                  {salesInvoiceShipment.incotermLocation
                    ? ` — ${salesInvoiceShipment.incotermLocation}`
                    : ""}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Ship To — only when shipment has a distinct address (not falling back to customer's main address) */}
          {shipmentCustomerName ? (
            <View style={tw("p-3")}>
              <Text
                style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
              >
                {t("shipTo")}
              </Text>
              <View style={tw("text-[9px] text-gray-800")}>
                <AddressBlock
                  name={shipmentCustomerName}
                  addressLine1={shipmentAddressLine1}
                  addressLine2={shipmentAddressLine2}
                  city={shipmentCity}
                  stateProvince={shipmentStateProvince}
                  postalCode={shipmentPostalCode}
                  country={shipmentCountryName}
                />
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
