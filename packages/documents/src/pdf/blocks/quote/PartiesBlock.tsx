// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isEoriCountry } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import { type DocumentBlock, makeText, quoteTexts } from "../../../template";
import { AddressRows, useTextRows } from "../textRows";
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
  const { customerCountryCode } = data.quoteCustomerDetails;
  const { row, boldRow } = useTextRows(t);

  return (
    <View style={tw("border border-gray-200 mb-4")}>
      <View style={tw("flex flex-row")}>
        {/* LEFT — To (customer) */}
        <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("to")}
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            <AddressRows t={t} prefix="customer" />
            {isEoriCountry(customerCountryCode) ? null : row("taxId")}
            {row("vat")}
            {row("eori")}
            {row("contact")}
            {row("email")}
          </View>
        </View>

        {/* RIGHT — Quote Details */}
        <View style={tw("w-1/2 p-3")}>
          <Text style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}>
            {t("quoteDetails")}
          </Text>
          <View style={tw("text-[9px] text-gray-800")}>
            {row("date")}
            {boldRow("expires")}
            {row("reference")}
            {row("maxLeadTime")}
            {row("paymentTerms")}
            {row("incoterm")}
          </View>
        </View>
      </View>
    </View>
  );
}
