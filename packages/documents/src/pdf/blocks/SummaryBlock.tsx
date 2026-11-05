// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatPercent } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_SUMMARY_OPTIONS,
  type SummaryBlock as SummaryBlockType
} from "../../template";
import {
  getLineDiscount,
  getLineGrossMerchandise,
  getTaxTotal,
  getTotal
} from "../../utils/sales-invoice";
import { useTw } from "./tw";
import type { SalesInvoiceData } from "./types";

type TaxRow = { key: string; label: string; amount: string };

/** The tax rows of the summary: one per component and rate when there are
 *  several, else the single total row, else none. */
export function summaryTaxRows(
  data: Pick<
    SalesInvoiceData,
    | "salesInvoiceLines"
    | "salesInvoice"
    | "currencyCode"
    | "numberFormatter"
    | "taxSummary"
    | "locale"
  >,
  taxLabel: string
): TaxRow[] {
  const {
    salesInvoiceLines,
    salesInvoice,
    currencyCode,
    numberFormatter,
    taxSummary,
    locale
  } = data;
  if (taxSummary.length > 1) {
    return taxSummary.map((entry) => ({
      key: `${entry.name ?? ""}:${entry.rate}`,
      label: `${entry.name ?? taxLabel} ${formatPercent(entry.rate, locale)} on ${numberFormatter.format(entry.base)} (${currencyCode})`,
      amount: numberFormatter.format(entry.tax)
    }));
  }
  if (salesInvoiceLines.some((line) => (line.taxPercent ?? 0) > 0)) {
    return [
      {
        key: "tax",
        label: `${taxLabel} (${currencyCode})`,
        amount: numberFormatter.format(
          getTaxTotal(salesInvoiceLines, salesInvoice)
        )
      }
    ];
  }
  return [];
}

export function SummaryBlock({
  block,
  data
}: {
  block: SummaryBlockType;
  data: SalesInvoiceData;
}) {
  const tw = useTw();
  const {
    salesInvoiceLines,
    salesInvoice,
    salesInvoiceShipment,
    currencyCode,
    numberFormatter,
    invoiceMessages
  } = data;
  const opts = { ...DEFAULT_SUMMARY_OPTIONS, ...block.options };
  const taxLabel = opts.taxLabel?.trim() || DEFAULT_SUMMARY_OPTIONS.taxLabel;
  const discount = salesInvoiceLines.reduce(
    (sum, line) => sum + getLineDiscount(line),
    0
  );

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
            Subtotal ({currencyCode})
          </Text>
          <Text style={tw("w-1/6 text-center text-gray-800")}>
            {numberFormatter.format(
              salesInvoiceLines.reduce(
                (sum, line) => sum + getLineGrossMerchandise(line),
                0
              )
            )}
          </Text>
        </View>

        {/* Discount - only when a line carries one, taken off the subtotal */}
        {discount !== 0 ? (
          <View
            style={[
              tw("flex flex-row py-1.5 px-3 text-[9px]"),
              { backgroundColor: "rgba(249, 250, 251, 0.6)" }
            ]}
          >
            <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
              Discount ({currencyCode})
            </Text>
            <Text style={tw("w-1/6 text-center text-gray-800")}>
              {numberFormatter.format(-discount)}
            </Text>
          </View>
        ) : null}

        {/* Add-Ons */}
        {salesInvoiceLines.some(
          (line) =>
            (line.convertedAddOnCost ?? 0) > 0 ||
            (line.convertedNonTaxableAddOnCost ?? 0) > 0
        ) ? (
          <View
            style={[
              tw("flex flex-row py-1.5 px-3 text-[9px]"),
              { backgroundColor: "rgba(249, 250, 251, 0.6)" }
            ]}
          >
            <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
              Add-Ons ({currencyCode})
            </Text>
            <Text style={tw("w-1/6 text-center text-gray-800")}>
              {numberFormatter.format(
                salesInvoiceLines.reduce(
                  (sum, line) =>
                    sum +
                    (line.convertedAddOnCost ?? 0) +
                    (line.convertedNonTaxableAddOnCost ?? 0),
                  0
                )
              )}
            </Text>
          </View>
        ) : null}

        {/* Shipping */}
        {(() => {
          const lineShipping = salesInvoiceLines.reduce(
            (sum, line) => sum + (line.convertedShippingCost ?? 0),
            0
          );
          const invoiceShipping =
            (salesInvoiceShipment?.shippingCost ?? 0) *
            (salesInvoice.exchangeRate ?? 1);
          const totalShipping = lineShipping + invoiceShipping;
          return totalShipping > 0 ? (
            <View
              style={[
                tw("flex flex-row py-1.5 px-3 text-[9px]"),
                { backgroundColor: "rgba(249, 250, 251, 0.6)" }
              ]}
            >
              <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
                Shipping ({currencyCode})
              </Text>
              <Text style={tw("w-1/6 text-center text-gray-800")}>
                {numberFormatter.format(totalShipping)}
              </Text>
            </View>
          ) : null;
        })()}

        {/* Taxes */}
        {summaryTaxRows(data, taxLabel).map((row) => (
          <View
            key={row.key}
            style={[
              tw("flex flex-row py-1.5 px-3 text-[9px]"),
              { backgroundColor: "rgba(249, 250, 251, 0.6)" }
            ]}
          >
            <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
              {row.label}
            </Text>
            <Text style={tw("w-1/6 text-center text-gray-800")}>
              {row.amount}
            </Text>
          </View>
        ))}

        <View style={tw("h-[1px] bg-gray-200")} />
        <View style={tw("flex flex-row py-2 px-3 text-[9px]")}>
          <Text style={tw("w-5/6 text-right pr-3 text-gray-800 font-bold")}>
            Total ({currencyCode})
          </Text>
          <Text style={tw("w-1/6 text-center text-gray-800 font-bold")}>
            {numberFormatter.format(
              getTotal(salesInvoiceLines, salesInvoice, salesInvoiceShipment)
            )}
          </Text>
        </View>
      </View>

      {/* VAT clauses of the lines' tax codes */}
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
