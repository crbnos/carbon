import type { JSONContent } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType
} from "../../../template";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTotal
} from "../../../utils/purchase-order";
import { formatTaxPercent } from "../../../utils/shared";
import { Note } from "../../components";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { PurchaseOrderData } from "./types";

const INDIRECT_TYPES = new Set([
  "Service",
  "G/L Account",
  "Fixed Asset",
  "Comment"
]);
const isIndirect = (t: string | null | undefined) =>
  !!t && INDIRECT_TYPES.has(t);

export function LineItemsBlock({
  block,
  data
}: {
  block: LineItemsBlockType;
  data: PurchaseOrderData;
}) {
  const tw = useTw();
  const {
    purchaseOrder,
    purchaseOrderLines,
    thumbnails,
    numberFormatter,
    theme,
    locale
  } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);
  let rowIndex = 0;

  return (
    <View>
      <View
        fixed
        style={[
          tw("flex flex-row py-3 px-3 text-[9px] font-bold items-center"),
          { backgroundColor: theme.accent, color: theme.accentForeground }
        ]}
      >
        <Text style={tw("w-[4%] text-center")}>#</Text>
        <Text style={tw("w-[22%]")}>Description</Text>
        <Text style={tw("w-[8%] text-center")}>Qty</Text>
        <Text style={tw("w-[7%] text-center")}>UOM</Text>
        <View style={tw("w-[10%] items-center")}>
          <Text>Required</Text>
        </View>
        <Text style={tw("w-[12%] text-center")}>Unit Price</Text>
        <Text style={tw("w-[12%] text-center")}>Net Value</Text>
        <Text style={tw("w-[12%] text-center")}>Tax Value</Text>
        <Text style={tw("w-[13%] text-center")}>Total</Text>
      </View>

      {purchaseOrderLines.map((line) => {
        const isEven = rowIndex % 2 === 0;
        rowIndex++;

        const netValue =
          (line.purchaseQuantity ?? 0) * (line.supplierUnitPrice ?? 0);

        return (
          <View key={line.id}>
            <View
              wrap={false}
              style={[
                tw(
                  "flex flex-col py-2 px-3 border-b border-gray-200 text-[9px]"
                ),
                {
                  backgroundColor:
                    opts.zebra && !isEven
                      ? "rgba(249, 250, 251, 0.6)"
                      : "transparent"
                }
              ]}
            >
              <View style={tw("flex flex-row")}>
                <Text style={tw("w-[4%] text-center text-gray-400")}>
                  {line.purchaseOrderLineType === "Comment" ? "" : rowIndex}
                </Text>
                <View style={tw("w-[22%] pr-2")}>
                  {isIndirect(line.purchaseOrderLineType) ? (
                    <Text style={{ ...tw("text-gray-900"), ...overflow }}>
                      {line.description ?? ""}
                    </Text>
                  ) : (
                    <>
                      <Text style={{ ...tw("text-gray-900"), ...overflow }}>
                        {getLineDescription(line)}
                      </Text>
                      <Text
                        style={{
                          ...tw("text-[7px] text-gray-600 mt-0.5"),
                          ...overflow
                        }}
                      >
                        {getLineDescriptionDetails(line)}
                      </Text>
                    </>
                  )}
                  {purchaseOrder.purchaseOrderType === "Outside Processing" &&
                    line.jobOperationDescription && (
                      <Text style={tw("text-[7px] text-gray-600 mt-0.5")}>
                        {line.jobOperationDescription}
                      </Text>
                    )}
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
                </View>
                <Text style={tw("w-[8%] text-center text-gray-600")}>
                  {line.purchaseOrderLineType === "Comment"
                    ? ""
                    : line.purchaseQuantity}
                </Text>
                <Text style={tw("w-[7%] text-center text-gray-600")}>
                  {line.purchaseOrderLineType === "Comment"
                    ? ""
                    : line.purchaseUnitOfMeasureCode}
                </Text>
                <Text style={tw("w-[10%] text-center text-gray-600")}>
                  {line.purchaseOrderLineType === "Comment" ||
                  !line.requiredDate
                    ? ""
                    : formatDate(line.requiredDate, undefined, locale)}
                </Text>
                <Text style={tw("w-[12%] text-center text-gray-600")}>
                  {line.purchaseOrderLineType === "Comment"
                    ? ""
                    : numberFormatter.format(line.supplierUnitPrice ?? 0)}
                </Text>
                <Text style={tw("w-[12%] text-center text-gray-600")}>
                  {line.purchaseOrderLineType === "Comment"
                    ? ""
                    : numberFormatter.format(netValue)}
                </Text>
                <View style={tw("w-[12%]")}>
                  {line.purchaseOrderLineType !== "Comment" && (
                    <View style={tw("flex flex-col items-center")}>
                      <Text style={tw("text-gray-600")}>
                        {numberFormatter.format(line.supplierTaxAmount ?? 0)}
                      </Text>
                      {formatTaxPercent(line.taxPercent) && (
                        <Text style={tw("text-[6px] text-gray-400")}>
                          {formatTaxPercent(line.taxPercent)}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
                <Text
                  style={tw("w-[13%] text-center text-gray-800 font-medium")}
                >
                  {line.purchaseOrderLineType === "Comment"
                    ? ""
                    : numberFormatter.format(getLineTotal(line))}
                </Text>
              </View>
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
