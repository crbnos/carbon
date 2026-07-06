import { formatDate, isEoriCountry } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { AddressBlock } from "../components";
import { useTw } from "./tw";
import type { SalesInvoiceData } from "./types";

export function PartiesBlock({ data }: { data: SalesInvoiceData }) {
  const tw = useTw();
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
    shipmentCountryName
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
            Bill To
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
            {customerTaxId &&
              !isEoriCountry(invoiceCountryName ?? customerCountryName) && (
                <Text>Tax ID: {customerTaxId}</Text>
              )}
            {customerVatNumber && <Text>VAT: {customerVatNumber}</Text>}
            {customerEori && <Text>EORI: {customerEori}</Text>}
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
              Invoice Details
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              {salesInvoice?.dateIssued && (
                <Text>
                  Date Issued:{" "}
                  {formatDate(salesInvoice.dateIssued, undefined, locale)}
                </Text>
              )}
              {salesInvoice?.dateDue && (
                <Text style={tw("font-bold")}>
                  Due Date:{" "}
                  {formatDate(salesInvoice.dateDue, undefined, locale)}
                </Text>
              )}
              {salesInvoice?.customerReference && (
                <Text>Customer Ref: {salesInvoice.customerReference}</Text>
              )}
              {salesOrderIds && salesOrderIds.length > 0 && (
                <Text>
                  {salesOrderIds.length > 1
                    ? "Sales Orders: "
                    : "Sales Order: "}
                  {salesOrderIds.join(", ")}
                </Text>
              )}
              {paymentTerm && <Text>Payment Terms: {paymentTerm.name}</Text>}
              {shippingMethod && <Text>Shipping: {shippingMethod.name}</Text>}
              {salesInvoiceShipment?.shippingTermId && (
                <Text>
                  Shipping Terms: {salesInvoiceShipment.shippingTermId}
                </Text>
              )}
              {salesInvoiceShipment?.incoterm && (
                <Text>
                  Incoterm: {salesInvoiceShipment.incoterm}
                  {salesInvoiceShipment.incotermLocation
                    ? ` — ${salesInvoiceShipment.incotermLocation}`
                    : ""}
                </Text>
              )}
            </View>
          </View>

          {/* Ship To — only when shipment has a distinct address (not falling back to customer's main address) */}
          {shipmentCustomerName && (
            <View style={tw("p-3")}>
              <Text
                style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
              >
                Ship To
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
          )}
        </View>
      </View>
    </View>
  );
}
