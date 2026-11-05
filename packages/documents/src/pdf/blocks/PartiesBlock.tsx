// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isEoriCountry } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  salesInvoiceTexts
} from "../../template";
import { AddressRows, useTextRows } from "./textRows";
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
  const { salesInvoiceLocations, salesOrderIds } = data;
  const { customerCountryName, invoiceCountryName, shipmentCustomerName } =
    salesInvoiceLocations;
  const { row, boldRow } = useTextRows(t);

  const salesOrderKey =
    (salesOrderIds?.length ?? 0) > 1 ? "salesOrders" : "salesOrder";

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
            <AddressRows t={t} prefix="billTo" />
            {isEoriCountry(invoiceCountryName ?? customerCountryName)
              ? null
              : row("taxId")}
            {row("vat")}
            {row("eori")}
            {row("contact")}
            {row("email")}
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
              {row("dateIssued")}
              {boldRow("dueDate")}
              {row("customerRef")}
              {t.shows("salesOrder") ? row(salesOrderKey) : null}
              {row("paymentTerms")}
              {row("shipping")}
              {row("shippingTerms")}
              {row("incoterm")}
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
                <AddressRows t={t} prefix="shipTo" />
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
