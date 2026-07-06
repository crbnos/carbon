import { Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_SUMMARY_OPTIONS,
  type SummaryBlock as SummaryBlockType
} from "../../../template";
import { getLineTaxableSubtotal, getTotal } from "../../../utils/sales-order";
import { useTw } from "../tw";
import type { SalesOrderData } from "./types";

export function SummaryBlock({
  block,
  data
}: {
  block: SummaryBlockType;
  data: SalesOrderData;
}) {
  const tw = useTw();
  const { salesOrderLines, salesOrder, currencyCode, numberFormatter } = data;
  const opts = { ...DEFAULT_SUMMARY_OPTIONS, ...block.options };
  const taxLabel = opts.taxLabel?.trim() || DEFAULT_SUMMARY_OPTIONS.taxLabel;

  return (
    <View style={tw("mb-4")}>
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
            salesOrderLines.reduce(
              (sum, line) =>
                sum + (line.saleQuantity ?? 0) * (line.convertedUnitPrice ?? 0),
              0
            )
          )}
        </Text>
      </View>

      {salesOrderLines.some(
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
              salesOrderLines.reduce(
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

      {(() => {
        const lineShipping = salesOrderLines.reduce(
          (sum, line) => sum + (line.convertedShippingCost ?? 0),
          0
        );
        const orderShipping =
          (salesOrder.shippingCost ?? 0) * (salesOrder.exchangeRate ?? 1);
        const totalShipping = lineShipping + orderShipping;
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

      {salesOrderLines.some((line) => (line.taxPercent ?? 0) > 0) && (
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
              salesOrderLines.reduce((sum, line) => {
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
          {numberFormatter.format(getTotal(salesOrderLines, salesOrder))}
        </Text>
      </View>
    </View>
  );
}
