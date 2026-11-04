// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate, isEoriCountry } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  purchaseOrderTexts
} from "../../../template";
import { AddressBlock } from "../../components";
import { useTw } from "../tw";
import type { PurchaseOrderData } from "./types";

export function PartiesBlock({
  block,
  data
}: {
  block: DocumentBlock;
  data: PurchaseOrderData;
}) {
  const tw = useTw();
  const t = makeText(purchaseOrderTexts.parties, block, data.vars);
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
            {t("supplier")}
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
            {t.shows("supplierTaxId") &&
            purchaseOrderLocations.supplierTaxId &&
            !isEoriCountry(supplierCountryCode) ? (
              <Text>
                {t("supplierTaxId")} {purchaseOrderLocations.supplierTaxId}
              </Text>
            ) : null}
            {t.shows("supplierVat") &&
            purchaseOrderLocations.supplierVatNumber ? (
              <Text>
                {t("supplierVat")} {purchaseOrderLocations.supplierVatNumber}
              </Text>
            ) : null}
            {t.shows("supplierEori") && purchaseOrderLocations.supplierEori ? (
              <Text>
                {t("supplierEori")} {purchaseOrderLocations.supplierEori}
              </Text>
            ) : null}
            {t.shows("supplierContact") &&
            purchaseOrderLocations.supplierContactName ? (
              <Text>
                {t("supplierContact")}{" "}
                {purchaseOrderLocations.supplierContactName}
              </Text>
            ) : null}
            {t.shows("supplierEmail") &&
            purchaseOrderLocations.supplierContactEmail ? (
              <Text>
                {t("supplierEmail")}{" "}
                {purchaseOrderLocations.supplierContactEmail}
              </Text>
            ) : null}
          </View>
        </View>

        {/* RIGHT — Order Info + Deliver To */}
        <View style={tw("w-1/2 flex flex-col")}>
          <View style={tw("p-3 border-b border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              {t("orderInfo")}
            </Text>
            <View style={tw("text-[9px] text-gray-800")}>
              {t.shows("poNumber") && purchaseOrder?.purchaseOrderId ? (
                <Text>
                  {t("poNumber")} {purchaseOrder.purchaseOrderId}
                </Text>
              ) : null}
              {t.shows("date") && purchaseOrder?.orderDate ? (
                <Text>
                  {t("date")}{" "}
                  {formatDate(purchaseOrder.orderDate, undefined, locale)}
                </Text>
              ) : null}
              {t.shows("currency") ? (
                <Text>
                  {t("currency")} {currencyCode}
                </Text>
              ) : null}
              {t.shows("reference") && purchaseOrder?.supplierReference ? (
                <Text>
                  {t("reference")} {purchaseOrder.supplierReference}
                </Text>
              ) : null}
              {t.shows("requested") && purchaseOrder?.receiptRequestedDate ? (
                <Text>
                  {t("requested")}{" "}
                  {formatDate(
                    purchaseOrder.receiptRequestedDate,
                    undefined,
                    locale
                  )}
                </Text>
              ) : null}
              {t.shows("promised") && purchaseOrder?.receiptPromisedDate ? (
                <Text>
                  {t("promised")}{" "}
                  {formatDate(
                    purchaseOrder.receiptPromisedDate,
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
              {t.shows("incoterm") && purchaseOrder?.incoterm ? (
                <Text>
                  {t("incoterm")} {purchaseOrder.incoterm}
                  {purchaseOrder.incotermLocation
                    ? ` — ${purchaseOrder.incotermLocation}`
                    : ""}
                </Text>
              ) : null}
            </View>
            <View style={tw("h-[1px] bg-gray-200 my-2")} />
            <View style={tw("text-[9px] text-gray-800")}>
              {t.shows("companyVat") && company.vatNumber ? (
                <Text>
                  {t("companyVat")} {company.vatNumber}
                </Text>
              ) : null}
              {t.shows("companyEori") && company.eori ? (
                <Text>
                  {t("companyEori")} {company.eori}
                </Text>
              ) : null}
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
                    {t.shows("buyerContact") && name ? (
                      <Text>
                        {t("buyerContact")} {name}
                      </Text>
                    ) : null}
                    {t.shows("buyerEmail") && email ? (
                      <Text>
                        {t("buyerEmail")} {email}
                      </Text>
                    ) : null}
                    {t.shows("buyerPhone") && phone ? (
                      <Text>
                        {t("buyerPhone")} {phone}
                      </Text>
                    ) : null}
                  </>
                );
              })()}
              {t.shows("billingEnquiries") &&
              accountsPayableBillingAddress?.email ? (
                <>
                  <Text style={tw("font-bold mt-1")}>
                    {t("billingEnquiries")}
                  </Text>
                  <Text style={tw("font-bold")}>
                    {accountsPayableBillingAddress.email}
                  </Text>
                </>
              ) : null}
            </View>
          </View>

          <View style={tw("p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              {t("deliverTo")}
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
