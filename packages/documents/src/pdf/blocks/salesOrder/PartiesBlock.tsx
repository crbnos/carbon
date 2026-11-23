// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isEoriCountry } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  salesOrderTexts
} from "../../../template";
import { AddressRows, useTextRows } from "../textRows";
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
  const { customerCountryName, paymentCustomerName } = data.salesOrderLocations;
  const { row } = useTextRows(t);

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        {/* LEFT — Customer block */}
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("customer")}
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            <AddressRows t={t} prefix="customer" />
            {isEoriCountry(customerCountryName) ? null : row("taxId")}
            {row("vat")}
            {row("eori")}
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
              {row("date")}
              {row("customerRef")}
              {row("requested")}
              {row("promised")}
              {row("paymentTerms")}
              {row("shipping")}
              {row("shippingTerms")}
              {row("incoterm")}
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
                <AddressRows t={t} prefix="billTo" />
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
