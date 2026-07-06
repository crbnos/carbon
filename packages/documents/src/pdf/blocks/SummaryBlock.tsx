import { Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_SUMMARY_OPTIONS,
  type SummaryBlock as SummaryBlockType
} from "../../template";
import { getLineTaxableSubtotal, getTotal } from "../../utils/sales-invoice";
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
  const {
    salesInvoiceLines,
    salesInvoice,
    salesInvoiceShipment,
    currencyCode,
    numberFormatter
  } = data;
  const opts = { ...DEFAULT_SUMMARY_OPTIONS, ...block.options };
  const taxLabel = opts.taxLabel?.trim() || DEFAULT_SUMMARY_OPTIONS.taxLabel;

  return (
    <View style={tw("mb-4")}>
      <View>
        {/* Subtotal - extended price only */}
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
                (sum, line) =>
                  sum + (line.quantity ?? 0) * (line.convertedUnitPrice ?? 0),
                0
              )
            )}
          </Text>
        </View>

        {/* Add-Ons */}
        {salesInvoiceLines.some(
          (line) =>
            (line.convertedAddOnCost ?? 0) > 0 ||
            (line.convertedNonTaxableAddOnCost ?? 0) > 0
        ) && (
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
        )}

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
        {salesInvoiceLines.some((line) => (line.taxPercent ?? 0) > 0) && (
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
              {numberFormatter.format(
                salesInvoiceLines.reduce((sum, line) => {
                  const taxPercent = line.taxPercent ?? 0;
                  return sum + getLineTaxableSubtotal(line) * taxPercent;
                }, 0)
              )}
            </Text>
          </View>
        )}

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
    </View>
  );
}
