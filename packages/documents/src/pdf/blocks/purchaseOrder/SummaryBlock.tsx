// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_SUMMARY_OPTIONS,
  makeText,
  purchaseOrderTexts,
  type SummaryBlock as SummaryBlockType
} from "../../../template";
import { useTw } from "../tw";
import type { PurchaseOrderData } from "./types";

export function SummaryBlock({
  block,
  data
}: {
  block: SummaryBlockType;
  data: PurchaseOrderData;
}) {
  const tw = useTw();
  const { currencyCode } = data;
  const taxLabel =
    block.options?.taxLabel?.trim() || DEFAULT_SUMMARY_OPTIONS.taxLabel;
  const t = makeText(purchaseOrderTexts.summary, block, data.vars);

  return (
    <View style={tw("mb-4")}>
      <View
        style={[
          tw("flex flex-row py-1.5 px-3 text-[9px]"),
          { backgroundColor: "rgba(249, 250, 251, 0.6)" }
        ]}
      >
        <Text style={tw("w-[87%] text-right pr-3 text-gray-600")}>
          {t("subtotal")}
        </Text>
        <Text style={tw("w-[13%] text-center text-gray-800")}>
          {t("subtotalValue")}
        </Text>
      </View>

      {t.prints("shippingValue") ? (
        <View
          style={[
            tw("flex flex-row py-1.5 px-3 text-[9px]"),
            { backgroundColor: "rgba(249, 250, 251, 0.6)" }
          ]}
        >
          <Text style={tw("w-[87%] text-right pr-3 text-gray-600")}>
            {t("shipping")}
          </Text>
          <Text style={tw("w-[13%] text-center text-gray-800")}>
            {t("shippingValue")}
          </Text>
        </View>
      ) : null}

      {t.prints("taxValue") ? (
        <View
          style={[
            tw("flex flex-row py-1.5 px-3 text-[9px]"),
            { backgroundColor: "rgba(249, 250, 251, 0.6)" }
          ]}
        >
          <Text style={tw("w-[87%] text-right pr-3 text-gray-600")}>
            {taxLabel} ({currencyCode})
          </Text>
          <Text style={tw("w-[13%] text-center text-gray-800")}>
            {t("taxValue")}
          </Text>
        </View>
      ) : null}

      <View style={tw("h-[1px] bg-gray-200")} />
      <View style={tw("flex flex-row py-2 px-3 text-[9px]")}>
        <Text style={tw("w-[87%] text-right pr-3 text-gray-800 font-bold")}>
          {t("total")}
        </Text>
        <Text style={tw("w-[13%] text-center text-gray-800 font-bold")}>
          {t("totalValue")}
        </Text>
      </View>
    </View>
  );
}
