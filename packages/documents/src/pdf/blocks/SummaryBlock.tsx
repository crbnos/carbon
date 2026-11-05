// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_SUMMARY_OPTIONS,
  makeText,
  type SummaryBlock as SummaryBlockType,
  salesInvoiceTexts
} from "../../template";
import { useTw } from "./tw";
import type { SalesInvoiceData } from "./types";

export function SummaryBlock({
  block,
  data
}: {
  block: SummaryBlockType;
  data: SalesInvoiceData;
}) {
  const tw = useTw();
  const { currencyCode } = data;
  const opts = { ...DEFAULT_SUMMARY_OPTIONS, ...block.options };
  const taxLabel = opts.taxLabel?.trim() || DEFAULT_SUMMARY_OPTIONS.taxLabel;
  const t = makeText(salesInvoiceTexts.summary, block, data.vars);

  return (
    <View style={tw("mb-4")}>
      <View>
        {/* Subtotal - extended list price, before line discounts */}
        <View
          style={[
            tw("flex flex-row py-1.5 px-3 text-[9px]"),
            { backgroundColor: "rgba(249, 250, 251, 0.6)" }
          ]}
        >
          <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
            {t("subtotal")}
          </Text>
          <Text style={tw("w-1/6 text-center text-gray-800")}>
            {t("subtotalValue")}
          </Text>
        </View>

        {/* Discount - only when a line carries one, taken off the subtotal */}
        {t.prints("discountValue") ? (
          <View
            style={[
              tw("flex flex-row py-1.5 px-3 text-[9px]"),
              { backgroundColor: "rgba(249, 250, 251, 0.6)" }
            ]}
          >
            <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
              {t("discount")}
            </Text>
            <Text style={tw("w-1/6 text-center text-gray-800")}>
              {t("discountValue")}
            </Text>
          </View>
        ) : null}

        {/* Add-Ons */}
        {t.prints("addOnsValue") ? (
          <View
            style={[
              tw("flex flex-row py-1.5 px-3 text-[9px]"),
              { backgroundColor: "rgba(249, 250, 251, 0.6)" }
            ]}
          >
            <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
              {t("addOns")}
            </Text>
            <Text style={tw("w-1/6 text-center text-gray-800")}>
              {t("addOnsValue")}
            </Text>
          </View>
        ) : null}

        {/* Shipping */}
        {t.prints("shippingValue") ? (
          <View
            style={[
              tw("flex flex-row py-1.5 px-3 text-[9px]"),
              { backgroundColor: "rgba(249, 250, 251, 0.6)" }
            ]}
          >
            <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
              {t("shipping")}
            </Text>
            <Text style={tw("w-1/6 text-center text-gray-800")}>
              {t("shippingValue")}
            </Text>
          </View>
        ) : null}

        {/* Taxes */}
        {t.prints("taxValue") ? (
          <View
            style={[
              tw("flex flex-row py-1.5 px-3 text-[9px]"),
              { backgroundColor: "rgba(249, 250, 251, 0.6)" }
            ]}
          >
            <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
              {taxLabel} ({currencyCode})
            </Text>
            <Text style={tw("w-1/6 text-center text-gray-800")}>
              {t("taxValue")}
            </Text>
          </View>
        ) : null}

        <View style={tw("h-[1px] bg-gray-200")} />
        <View style={tw("flex flex-row py-2 px-3 text-[9px]")}>
          <Text style={tw("w-5/6 text-right pr-3 text-gray-800 font-bold")}>
            {t("total")}
          </Text>
          <Text style={tw("w-1/6 text-center text-gray-800 font-bold")}>
            {t("totalValue")}
          </Text>
        </View>
      </View>
    </View>
  );
}
