// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isEoriCountry } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import {
  type DocumentBlock,
  makeText,
  purchaseOrderTexts
} from "../../../template";
import { AddressRows, useTextRows } from "../textRows";
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
  const { purchaseOrderLocations } = data;
  const { row } = useTextRows(t);

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        {/* LEFT — Supplier */}
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("supplier")}
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            <AddressRows t={t} prefix="supplier" />
            {isEoriCountry(purchaseOrderLocations.supplierCountryCode)
              ? null
              : row("supplierTaxId")}
            {row("supplierVat")}
            {row("supplierEori")}
            {row("supplierContact")}
            {row("supplierEmail")}
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
              {row("poNumber")}
              {row("date")}
              {row("currency")}
              {row("reference")}
              {row("requested")}
              {row("promised")}
              {row("paymentTerms")}
              {row("incoterm")}
            </View>
            <View style={tw("h-[1px] bg-gray-200 my-2")} />
            <View style={tw("text-[9px] text-gray-800")}>
              {row("companyVat")}
              {row("companyEori")}
              {row("buyerContact")}
              {row("buyerEmail")}
              {row("buyerPhone")}
              {t.prints("billingEmail") ? (
                <>
                  <Text style={tw("font-bold mt-1")}>
                    {t("billingEnquiries")}
                  </Text>
                  <Text style={tw("font-bold")}>{t("billingEmail")}</Text>
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
              <AddressRows t={t} prefix="deliverTo" />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
