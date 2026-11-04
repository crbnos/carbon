// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate, isEoriCountry } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  salesOrderTexts
} from "../../../template";
import { AddressBlock } from "../../components";
import { useTw } from "../tw";
import type { SalesOrderData } from "./types";

export function PartiesBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: SalesOrderData;
}) {
  const tw = useTw();
  const t = makeText(salesOrderTexts.parties, block, data.vars);
  const {
    salesOrder,
    salesOrderLocations,
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
    paymentCustomerName,
    paymentAddressLine1,
    paymentAddressLine2,
    paymentCity,
    paymentStateProvince,
    paymentPostalCode,
    paymentCountryName
  } = salesOrderLocations;

  const paymentTerm = paymentTerms?.find(
    (term) => term.id === salesOrder?.paymentTermId
  );
  const shippingMethod = shippingMethods?.find(
    (method) => method.id === salesOrder?.shippingMethodId
  );

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        {/* LEFT — Customer block */}
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("customer")}
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            <AddressBlock
              name={customerName}
              addressLine1={customerAddressLine1}
              addressLine2={customerAddressLine2}
              city={customerCity}
              stateProvince={customerStateProvince}
              postalCode={customerPostalCode}
              country={customerCountryName}
            />
            {t.shows("taxId") &&
            customerTaxId &&
            !isEoriCountry(customerCountryName) ? (
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
          </View>
        </View>

        {/* RIGHT — Order Details + Bill To stacked */}
        <View style={tw("w-1/2 flex flex-col")}>
          <View
            style={tw(
              paymentCustomerName ? "p-3 border-b border-gray-200" : "p-3"
            )}
          >
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              {t("orderDetails")}
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              {t.shows("date") && salesOrder?.orderDate ? (
                <Text>
                  {t("date")}{" "}
                  {formatDate(salesOrder.orderDate, undefined, locale)}
                </Text>
              ) : null}
              {t.shows("customerRef") && salesOrder?.customerReference ? (
                <Text>
                  {t("customerRef")} {salesOrder.customerReference}
                </Text>
              ) : null}
              {t.shows("requested") && salesOrder?.receiptRequestedDate ? (
                <Text>
                  {t("requested")}{" "}
                  {formatDate(
                    salesOrder.receiptRequestedDate,
                    undefined,
                    locale
                  )}
                </Text>
              ) : null}
              {t.shows("promised") && salesOrder?.receiptPromisedDate ? (
                <Text>
                  {t("promised")}{" "}
                  {formatDate(
                    salesOrder.receiptPromisedDate,
                    undefined,
                    locale
                  )}
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
              {t.shows("shippingTerms") && salesOrder?.shippingTermName ? (
                <Text>
                  {t("shippingTerms")} {salesOrder.shippingTermName}
                </Text>
              ) : null}
              {t.shows("incoterm") && salesOrder?.incoterm ? (
                <Text>
                  {t("incoterm")} {salesOrder.incoterm}
                  {salesOrder.incotermLocation
                    ? ` — ${salesOrder.incotermLocation}`
                    : ""}
                </Text>
              ) : null}
            </View>
          </View>

          {paymentCustomerName ? (
            <View style={tw("p-3")}>
              <Text
                style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
              >
                {t("billTo")}
              </Text>
              <View style={tw("text-[9px] text-gray-800")}>
                <AddressBlock
                  name={paymentCustomerName}
                  addressLine1={paymentAddressLine1}
                  addressLine2={paymentAddressLine2}
                  city={paymentCity}
                  stateProvince={paymentStateProvince}
                  postalCode={paymentPostalCode}
                  country={paymentCountryName}
                />
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
