// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate, isEoriCountry } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { AddressBlock } from "../../components";
import { useTw } from "../tw";
import type { SalesOrderData } from "./types";

export function PartiesBlock({ data }: { data: SalesOrderData }) {
  const tw = useTw();
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
            Customer
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
            {customerTaxId && !isEoriCountry(customerCountryName) ? (
              <Text>Tax ID: {customerTaxId}</Text>
            ) : null}
            {customerVatNumber ? <Text>VAT: {customerVatNumber}</Text> : null}
            {customerEori ? <Text>EORI: {customerEori}</Text> : null}
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
              Order Details
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              {salesOrder?.orderDate ? (
                <Text>
                  Date: {formatDate(salesOrder.orderDate, undefined, locale)}
                </Text>
              ) : null}
              {salesOrder?.customerReference ? (
                <Text>Customer Ref: {salesOrder.customerReference}</Text>
              ) : null}
              {salesOrder?.receiptRequestedDate ? (
                <Text>
                  Requested:{" "}
                  {formatDate(
                    salesOrder.receiptRequestedDate,
                    undefined,
                    locale
                  )}
                </Text>
              ) : null}
              {salesOrder?.receiptPromisedDate ? (
                <Text>
                  Promised:{" "}
                  {formatDate(
                    salesOrder.receiptPromisedDate,
                    undefined,
                    locale
                  )}
                </Text>
              ) : null}
              {paymentTerm ? (
                <Text>Payment Terms: {paymentTerm.name}</Text>
              ) : null}
              {shippingMethod ? (
                <Text>Shipping: {shippingMethod.name}</Text>
              ) : null}
              {salesOrder?.shippingTermName ? (
                <Text>Shipping Terms: {salesOrder.shippingTermName}</Text>
              ) : null}
              {salesOrder?.incoterm ? (
                <Text>
                  Incoterm: {salesOrder.incoterm}
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
                Bill To
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
