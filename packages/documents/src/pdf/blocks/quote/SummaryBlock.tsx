import { Text, View } from "@react-pdf/renderer";
import { useTw } from "../tw";
import type { QuoteData } from "./types";

export function QuoteSummaryBlock({ data }: { data: QuoteData }) {
  const tw = useTw();
  const ROW = [
    tw("flex flex-row py-1.5 px-3 text-[9px]"),
    { backgroundColor: "rgba(249, 250, 251, 0.6)" }
  ];
  const { hasSinglePricePerLine, totals, currencyCode, numberFormatter } = data;

  // The Quote summary only renders when every line has a single price.
  if (!hasSinglePricePerLine) return null;

  return (
    <View style={tw("mb-4")}>
      <View style={ROW}>
        <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
          Subtotal ({currencyCode})
        </Text>
        <Text style={tw("w-1/6 text-center text-gray-800")}>
          {numberFormatter.format(totals.subtotal)}
        </Text>
      </View>
      <View style={ROW}>
        <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
          Shipping ({currencyCode})
        </Text>
        <Text style={tw("w-1/6 text-center text-gray-800")}>
          {numberFormatter.format(totals.shipping)}
        </Text>
      </View>
      {totals.fees > 0 && (
        <View style={ROW}>
          <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
            Fees ({currencyCode})
          </Text>
          <Text style={tw("w-1/6 text-center text-gray-800")}>
            {numberFormatter.format(totals.fees)}
          </Text>
        </View>
      )}
      <View style={ROW}>
        <Text style={tw("w-5/6 text-right pr-3 text-gray-600")}>
          Taxes ({currencyCode})
        </Text>
        <Text style={tw("w-1/6 text-center text-gray-800")}>
          {numberFormatter.format(totals.taxes)}
        </Text>
      </View>
      <View style={tw("h-[1px] bg-gray-200")} />
      <View style={tw("flex flex-row py-2 px-3 text-[9px]")}>
        <Text style={tw("w-5/6 text-right pr-3 text-gray-800 font-bold")}>
          Total ({currencyCode})
        </Text>
        <Text style={tw("w-1/6 text-center text-gray-800 font-bold")}>
          {numberFormatter.format(totals.total)}
        </Text>
      </View>
    </View>
  );
}
