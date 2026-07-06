import type { JSONContent } from "@carbon/react";
import { Image, Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType
} from "../../../template";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTaxableSubtotal,
  getLineTotal
} from "../../../utils/sales-order";
import { Note } from "../../components";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { SalesOrderData } from "./types";

export function LineItemsBlock({
  block,
  data
}: {
  block: LineItemsBlockType;
  data: SalesOrderData;
}) {
  const tw = useTw();
  const { salesOrderLines, thumbnails, numberFormatter, theme } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);
  let rowIndex = 0;

  return (
    <View>
      {/* Header */}
      <View
        fixed
        style={[
          tw("flex flex-row py-2 px-3 text-[9px] font-bold items-center"),
          { backgroundColor: theme.accent, color: theme.accentForeground }
        ]}
      >
        <Text style={tw("w-1/2")}>Description</Text>
        <Text style={tw("w-1/6 text-center")}>Qty</Text>
        <Text style={tw("w-1/6 text-center")}>Unit Price</Text>
        <Text style={tw("w-1/6 text-center")}>Total</Text>
      </View>

      {salesOrderLines.map((line) => {
        const isEven = rowIndex % 2 === 0;
        rowIndex++;

        const lineAddOnCost = line.convertedAddOnCost ?? 0;
        const lineNonTaxableAddOnCost = line.convertedNonTaxableAddOnCost ?? 0;
        const lineShippingCost = line.convertedShippingCost ?? 0;
        const lineTaxPercent = line.taxPercent ?? 0;
        const lineTaxAmount = getLineTaxableSubtotal(line) * lineTaxPercent;
        const totalTaxAndFees =
          lineAddOnCost +
          lineNonTaxableAddOnCost +
          lineShippingCost +
          lineTaxAmount;

        return (
          <View key={line.id}>
            <View
              wrap={false}
              style={[
                tw(
                  "flex flex-row py-2 px-3 border-b border-gray-200 text-[10px]"
                ),
                {
                  backgroundColor:
                    opts.zebra && !isEven
                      ? "rgba(249, 250, 251, 0.6)"
                      : "transparent"
                }
              ]}
            >
              <View style={tw("w-1/2 pr-2")}>
                <Text style={{ ...tw("text-gray-800"), ...overflow }}>
                  {getLineDescription(line)}
                </Text>
                <Text
                  style={{
                    ...tw("text-[9px] text-gray-600 mt-0.5"),
                    ...overflow
                  }}
                >
                  {getLineDescriptionDetails(line)}
                </Text>
                {opts.showThumbnails &&
                  thumbnails &&
                  line.id &&
                  line.id in thumbnails &&
                  thumbnails[line.id] && (
                    <View style={tw("mt-1 w-16")}>
                      <Image
                        src={thumbnails[line.id]!}
                        style={tw("w-full h-auto")}
                      />
                    </View>
                  )}
                {line.salesOrderLineType !== "Comment" &&
                  totalTaxAndFees > 0 && (
                    <View style={tw("mt-1")}>
                      <Text style={tw("text-[9px] text-gray-600 font-bold")}>
                        Tax & Fees
                      </Text>
                      {lineShippingCost > 0 && (
                        <Text style={tw("text-[9px] text-gray-600")}>
                          - Shipping
                        </Text>
                      )}
                      {lineAddOnCost > 0 && (
                        <Text style={tw("text-[9px] text-gray-600")}>
                          - Add-On
                        </Text>
                      )}
                      {lineNonTaxableAddOnCost > 0 && (
                        <Text style={tw("text-[9px] text-gray-600")}>
                          - Non-Taxable Add-On
                        </Text>
                      )}
                      {lineTaxPercent > 0 && (
                        <Text style={tw("text-[9px] text-gray-600")}>
                          - Tax ({(lineTaxPercent * 100).toFixed(0)}%)
                        </Text>
                      )}
                    </View>
                  )}
              </View>
              <Text style={tw("w-1/6 text-center text-gray-600")}>
                {line.salesOrderLineType === "Comment"
                  ? ""
                  : `${line.saleQuantity} ${line.unitOfMeasureCode ?? "EA"}`}
              </Text>
              <Text style={tw("w-1/6 text-center text-gray-600")}>
                {line.salesOrderLineType === "Comment"
                  ? ""
                  : numberFormatter.format(line.convertedUnitPrice ?? 0)}
              </Text>
              <Text style={tw("w-1/6 text-center text-gray-800 font-medium")}>
                {line.salesOrderLineType === "Comment"
                  ? ""
                  : numberFormatter.format(getLineTotal(line))}
              </Text>
            </View>
            {Object.keys(line.externalNotes ?? {}).length > 0 && (
              <View style={tw("px-3 py-2 border-b border-gray-200")}>
                <Note
                  key={`${line.id}-notes`}
                  content={line.externalNotes as JSONContent}
                />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
