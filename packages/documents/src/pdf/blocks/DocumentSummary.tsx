// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatPercent } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_SUMMARY_OPTIONS,
  makeText,
  type SummaryBlock,
  type TextEntry
} from "../../template";
import type { TaxSummaryEntry } from "../../utils/tax-summary";
import { useTw } from "./tw";

type SummaryRow<K extends string> = {
  label: K;
  value: K;
  /** Printed even with nothing to show (a quote's zero shipping). */
  always?: boolean;
};

export type SummaryTaxRow = { key: string; label: string; amount: string };

/**
 * The tax rows of the summary: one per component and rate when the document
 * has two or more ("GST 5% on 1,200.00 (CAD)"), else the single tax row when
 * it prints, else none. Hiding the tax value hides the component rows too.
 */
export function summaryTaxRows({
  taxSummary,
  taxLabel,
  currencyCode,
  locale,
  numberFormatter,
  taxValue,
  printsTax,
  showsTax
}: {
  taxSummary: TaxSummaryEntry[];
  taxLabel: string;
  currencyCode: string | null | undefined;
  locale: string;
  numberFormatter: Intl.NumberFormat | undefined;
  /** The printed single tax amount (`taxValue`). */
  taxValue: string;
  /** The single tax row prints. */
  printsTax: boolean;
  /** The user has not hidden the tax value. */
  showsTax: boolean;
}): SummaryTaxRow[] {
  if (taxSummary.length > 1 && numberFormatter) {
    if (!showsTax) return [];
    return taxSummary.map((entry) => ({
      key: `${entry.name ?? ""}:${entry.rate}`,
      label: `${entry.name ?? taxLabel} ${formatPercent(entry.rate, locale)} on ${numberFormatter.format(entry.base)} (${currencyCode})`,
      amount: numberFormatter.format(entry.tax)
    }));
  }
  if (printsTax) {
    return [
      { key: "tax", label: `${taxLabel} (${currencyCode})`, amount: taxValue }
    ];
  }
  return [];
}

/**
 * A document's totals: its rows, the tax row under the block's own label, then the
 * total. `labelWidth` and `valueWidth` line the amounts up with the table above.
 * With two or more `taxSummary` entries the tax row becomes one row per tax
 * component; `invoiceMessages` (the tax codes' clauses) print under the total.
 */
export function DocumentSummary<K extends string>({
  block,
  texts,
  vars,
  currencyCode,
  rows,
  taxAlways = false,
  taxSummary = [],
  locale = "en-US",
  numberFormatter,
  invoiceMessages = [],
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
  /** Tax per component and rate; two or more replace the single tax row. */
  taxSummary?: TaxSummaryEntry[];
  locale?: string;
  /** Formats the component rows' bases and amounts. */
  numberFormatter?: Intl.NumberFormat;
  /** The tax codes' invoice messages, printed under the total. */
  invoiceMessages?: string[];
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
      {summaryTaxRows({
        taxSummary,
        taxLabel,
        currencyCode,
        locale,
        numberFormatter,
        taxValue: t("taxValue"),
        printsTax: taxAlways || t.prints("taxValue"),
        showsTax: t.shows("taxValue")
      }).map((tax) => (
        <View key={tax.key} style={row}>
          <Text style={tw(`${labelWidth} text-right pr-3 text-gray-600`)}>
            {/* The single row prints as it did before tax codes. */}
            {tax.key === "tax" ? (
              <>
                {taxLabel} ({currencyCode})
              </>
            ) : (
              tax.label
            )}
          </Text>
          <Text style={tw(`${valueWidth} text-center text-gray-800`)}>
            {tax.amount}
          </Text>
        </View>
      ))}
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
      {/* The tax codes' clauses (a VAT exemption, a reverse charge) */}
      {invoiceMessages.length > 0 ? (
        <View style={tw("px-3 pt-1 text-[8px] text-gray-600")}>
          {invoiceMessages.map((message) => (
            <Text key={message}>{message}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
