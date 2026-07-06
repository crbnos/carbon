import { formatDate, isEoriCountry } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { AddressBlock } from "../../components";
import { useTw } from "../tw";
import type { PurchaseOrderData } from "./types";

export function PartiesBlock({ data }: { data: PurchaseOrderData }) {
  const tw = useTw();
  const {
    purchaseOrder,
    purchaseOrderLocations,
    paymentTerms,
    company,
    accountsPayableBillingAddress,
    currencyCode,
    locale
  } = data;
  const {
    supplierName,
    supplierAddressLine1,
    supplierAddressLine2,
    supplierCity,
    supplierStateProvince,
    supplierPostalCode,
    supplierCountryCode,
    supplierCountryName,
    deliveryName,
    deliveryAddressLine1,
    deliveryAddressLine2,
    deliveryCity,
    deliveryStateProvince,
    deliveryPostalCode,
    deliveryCountryCode,
    deliveryCountryName,
    dropShipment,
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerStateProvince,
    customerPostalCode,
    customerCountryCode,
    customerCountryName
  } = purchaseOrderLocations;

  const paymentTerm = paymentTerms?.find(
    (term) => term.id === purchaseOrder?.paymentTermId
  );

  const shipAddress = dropShipment
    ? {
        name: customerName,
        addressLine1: customerAddressLine1,
        addressLine2: customerAddressLine2,
        city: customerCity,
        stateProvince: customerStateProvince,
        postalCode: customerPostalCode,
        country: customerCountryName ?? customerCountryCode
      }
    : {
        name: deliveryName,
        addressLine1: deliveryAddressLine1,
        addressLine2: deliveryAddressLine2,
        city: deliveryCity,
        stateProvince: deliveryStateProvince,
        postalCode: deliveryPostalCode,
        country: deliveryCountryName ?? deliveryCountryCode
      };

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        {/* LEFT — Supplier */}
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            Supplier
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            <AddressBlock
              name={supplierName}
              addressLine1={supplierAddressLine1}
              addressLine2={supplierAddressLine2}
              city={supplierCity}
              stateProvince={supplierStateProvince}
              postalCode={supplierPostalCode}
              country={supplierCountryName ?? supplierCountryCode}
            />
            {purchaseOrderLocations.supplierTaxId &&
              !isEoriCountry(supplierCountryCode) && (
                <Text>Tax ID: {purchaseOrderLocations.supplierTaxId}</Text>
              )}
            {purchaseOrderLocations.supplierVatNumber && (
              <Text>VAT: {purchaseOrderLocations.supplierVatNumber}</Text>
            )}
            {purchaseOrderLocations.supplierEori && (
              <Text>EORI: {purchaseOrderLocations.supplierEori}</Text>
            )}
            {purchaseOrderLocations.supplierContactName && (
              <Text>Contact: {purchaseOrderLocations.supplierContactName}</Text>
            )}
            {purchaseOrderLocations.supplierContactEmail && (
              <Text>Email: {purchaseOrderLocations.supplierContactEmail}</Text>
            )}
          </View>
        </View>

        {/* RIGHT — Order Info + Deliver To */}
        <View style={tw("w-1/2 flex flex-col")}>
          <View style={tw("p-3 border-b border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Order Info
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              {purchaseOrder?.purchaseOrderId && (
                <Text>PO Number: {purchaseOrder.purchaseOrderId}</Text>
              )}
              {purchaseOrder?.orderDate && (
                <Text>
                  Date: {formatDate(purchaseOrder.orderDate, undefined, locale)}
                </Text>
              )}
              <Text>Currency: {currencyCode}</Text>
              {purchaseOrder?.supplierReference && (
                <Text>Reference: {purchaseOrder.supplierReference}</Text>
              )}
              {purchaseOrder?.receiptRequestedDate && (
                <Text>
                  Requested:{" "}
                  {formatDate(
                    purchaseOrder.receiptRequestedDate,
                    undefined,
                    locale
                  )}
                </Text>
              )}
              {purchaseOrder?.receiptPromisedDate && (
                <Text>
                  Promised:{" "}
                  {formatDate(
                    purchaseOrder.receiptPromisedDate,
                    undefined,
                    locale
                  )}
                </Text>
              )}
              {paymentTerm && <Text>Payment Terms: {paymentTerm.name}</Text>}
              {purchaseOrder?.incoterm && (
                <Text>
                  Incoterm: {purchaseOrder.incoterm}
                  {purchaseOrder.incotermLocation
                    ? ` — ${purchaseOrder.incotermLocation}`
                    : ""}
                </Text>
              )}
            </View>
            <View style={tw("h-[1px] bg-gray-200 my-2")} />
            <View style={tw("text-[9px] text-gray-800")}>
              {company.vatNumber && <Text>VAT: {company.vatNumber}</Text>}
              {(() => {
                const name =
                  purchaseOrder.assigneeFullName ??
                  purchaseOrder.accountManagerFullName ??
                  purchaseOrder.createdByFullName;
                const email =
                  purchaseOrder.assigneeEmail ??
                  purchaseOrder.accountManagerEmail ??
                  purchaseOrder.createdByEmail;
                const phone =
                  purchaseOrder.assigneePhone ??
                  purchaseOrder.accountManagerPhone ??
                  purchaseOrder.createdByPhone;
                return (
                  <>
                    {name && <Text>Contact: {name}</Text>}
                    {email && <Text>Email: {email}</Text>}
                    {phone && <Text>Phone: {phone}</Text>}
                  </>
                );
              })()}
              {accountsPayableBillingAddress?.email && (
                <>
                  <Text style={tw("font-bold mt-1")}>
                    Billing documents and enquiries:
                  </Text>
                  <Text style={tw("font-bold")}>
                    {accountsPayableBillingAddress.email}
                  </Text>
                </>
              )}
            </View>
          </View>

          <View style={tw("p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Deliver To
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              <AddressBlock {...shipAddress} />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
