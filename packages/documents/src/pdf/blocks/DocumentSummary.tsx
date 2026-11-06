// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_SUMMARY_OPTIONS,
  makeText,
  type SummaryBlock,
  type TextEntry
} from "../../template";
import { useTw } from "./tw";

type SummaryRow<K extends string> = {
  label: K;
  value: K;
  /** Printed even with nothing to show (a quote's zero shipping). */
  always?: boolean;
};

/**
 * A document's totals: its rows, the tax row under the block's own label, then the
 * total. `labelWidth` and `valueWidth` line the amounts up with the table above.
 */
export function DocumentSummary<K extends string>({
  block,
  texts,
  vars,
  currencyCode,
  rows,
  taxAlways = false,
  labelWidth = "w-5/6",
  valueWidth = "w-1/6"
}: {
  block: SummaryBlock;
  texts: readonly (TextEntry & {
    key: K | "taxValue" | "total" | "totalValue";
  })[];
  vars: Record<string, string>;
  currencyCode: string | null | undefined;
  rows: SummaryRow<NoInfer<K>>[];
  taxAlways?: boolean;
  labelWidth?: string;
  valueWidth?: string;
}) {
  const tw = useTw();
  const t = makeText(texts, block, vars);
  const taxLabel =
    block.options?.taxLabel?.trim() || DEFAULT_SUMMARY_OPTIONS.taxLabel;
  const row = [
    tw("flex flex-row py-1.5 px-3 text-[9px]"),
    { backgroundColor: "rgba(249, 250, 251, 0.6)" }
  ];

  return (
    <View style={tw("mb-4")}>
      {rows.map(({ label, value, always }) =>
        always || t.prints(value) ? (
          <View key={value} style={row}>
            <Text style={tw(`${labelWidth} text-right pr-3 text-gray-600`)}>
              {t(label)}
            </Text>
            <Text style={tw(`${valueWidth} text-center text-gray-800`)}>
              {t(value)}
            </Text>
          </View>
        ) : null
      )}
      {taxAlways || t.prints("taxValue") ? (
        <View style={row}>
          <Text style={tw(`${labelWidth} text-right pr-3 text-gray-600`)}>
            {taxLabel} ({currencyCode})
          </Text>
          <Text style={tw(`${valueWidth} text-center text-gray-800`)}>
            {t("taxValue")}
          </Text>
        </View>
      ) : null}
      <View style={tw("h-[1px] bg-gray-200")} />
      <View style={tw("flex flex-row py-2 px-3 text-[9px]")}>
        <Text
          style={tw(`${labelWidth} text-right pr-3 text-gray-800 font-bold`)}
        >
          {t("total")}
        </Text>
        <Text style={tw(`${valueWidth} text-center text-gray-800 font-bold`)}>
          {t("totalValue")}
        </Text>
      </View>
    </View>
  );
}
