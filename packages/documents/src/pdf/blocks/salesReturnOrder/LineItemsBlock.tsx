import { Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType
} from "../../../template";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { SalesReturnOrderData } from "./types";

export function LineItemsBlock({
  block,
  data
}: {
  block: LineItemsBlockType;
  data: SalesReturnOrderData;
}) {
  const tw = useTw();
  const {
    salesReturnOrderLines,
    numberFormatter,
    rateFormatter,
    currencyCode,
    theme
  } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);

  const total = salesReturnOrderLines.reduce(
    (sum, line) => sum + (line.quantity ?? 0) * (line.unitPrice ?? 0),
    0
  );

  return (
    <View style={tw("mb-4")}>
      {/* Header */}
      <View
        fixed
        style={[
          tw("flex flex-row py-2 px-3 text-[9px] font-bold items-center"),
          { backgroundColor: theme.accent, color: theme.accentForeground }
        ]}
      >
        <Text style={tw("w-[6%] text-center")}>#</Text>
        <Text style={tw("w-[40%]")}>Item</Text>
        <Text style={tw("w-[16%] text-center")}>Qty Authorized</Text>
        <Text style={tw("w-[18%] text-center")}>Unit Price</Text>
        <Text style={tw("w-[20%] text-center")}>Reason</Text>
      </View>

      {salesReturnOrderLines.map((line, index) => (
        <View
          key={line.id}
          wrap={false}
          style={[
            tw("flex flex-row py-2 px-3 border-b border-gray-200 text-[10px]"),
            {
              backgroundColor:
                opts.zebra && index % 2 === 1
                  ? "rgba(249, 250, 251, 0.6)"
                  : "transparent"
            }
          ]}
        >
          <Text style={tw("w-[6%] text-center text-gray-600")}>
            {line.lineNumber}
          </Text>
          <View style={tw("w-[40%] pr-2")}>
            <Text style={{ ...tw("text-gray-800"), ...overflow }}>
              {line.item?.readableIdWithRevision ?? ""}
            </Text>
            {line.item?.name && (
              <Text
                style={{
                  ...tw("text-[9px] text-gray-600 mt-0.5"),
                  ...overflow
                }}
              >
                {line.item.name}
              </Text>
            )}
          </View>
          <Text style={tw("w-[16%] text-center text-gray-600")}>
            {`${line.quantity ?? 0} ${line.unitOfMeasureCode ?? "EA"}`}
          </Text>
          <Text style={tw("w-[18%] text-center text-gray-600")}>
            {rateFormatter.format(line.unitPrice ?? 0)}
          </Text>
          <Text style={tw("w-[20%] text-center text-gray-600")}>
            {line.returnReason?.name ?? ""}
          </Text>
        </View>
      ))}

      {total > 0 && (
        <View style={tw("flex flex-row py-2 px-3 text-[9px]")}>
          <Text style={tw("w-[62%] text-right pr-3 text-gray-800 font-bold")}>
            Total ({currencyCode})
          </Text>
          <Text style={tw("w-[18%] text-center text-gray-800 font-bold")}>
            {numberFormatter.format(total)}
          </Text>
          <Text style={tw("w-[20%]")} />
        </View>
      )}
    </View>
  );
}
