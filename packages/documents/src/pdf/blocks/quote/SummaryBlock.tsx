// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_SUMMARY_OPTIONS,
  makeText,
  quoteTexts,
  type SummaryBlock as SummaryBlockType
} from "../../../template";
import { useTw } from "../tw";
import type { QuoteData } from "./types";

export function QuoteSummaryBlock({
  block,
  data
}: {
  block: SummaryBlockType;
  data: QuoteData;
}) {
  const tw = useTw();
  const ROW = [
    tw("flex flex-row py-1.5 px-3 text-[9px]"),
    { backgroundColor: "rgba(249, 250, 251, 0.6)" }
  ];
  const { hasSinglePricePerLine, totals, currencyCode, numberFormatter } = data;
  const taxLabel =
    block.options?.taxLabel?.trim() || DEFAULT_SUMMARY_OPTIONS.taxLabel;
  const t = makeText(quoteTexts.summary, block, data.vars);

  // The Quote summary only renders when every line has a single price.
  if (!hasSinglePricePerLine) return null;

  return (
    <View style={tw("mb-4")}>
      <View style={ROW}>
        <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
          {t("subtotal")} ({currencyCode})
        </Text>
        <Text style={tw("w-1/6 text-center text-gray-800")}>
          {numberFormatter.format(totals.subtotal)}
        </Text>
      </View>
      <View style={ROW}>
        <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
          {t("shipping")} ({currencyCode})
        </Text>
        <Text style={tw("w-1/6 text-center text-gray-800")}>
          {numberFormatter.format(totals.shipping)}
        </Text>
      </View>
      {totals.fees > 0 ? (
        <View style={ROW}>
          <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
            {t("fees")} ({currencyCode})
          </Text>
          <Text style={tw("w-1/6 text-center text-gray-800")}>
            {numberFormatter.format(totals.fees)}
          </Text>
        </View>
      ) : null}
      <View style={ROW}>
        <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
          {taxLabel} ({currencyCode})
        </Text>
        <Text style={tw("w-1/6 text-center text-gray-800")}>
          {numberFormatter.format(totals.taxes)}
        </Text>
      </View>
      <View style={tw("h-[1px] bg-gray-200")} />
      <View style={tw("flex flex-row py-2 px-3 text-[9px]")}>
        <Text style={tw("w-5/6 text-right pr-3 text-gray-800 font-bold")}>
          {t("total")} ({currencyCode})
        </Text>
        <Text style={tw("w-1/6 text-center text-gray-800 font-bold")}>
          {numberFormatter.format(totals.total)}
        </Text>
      </View>
    </View>
  );
}
