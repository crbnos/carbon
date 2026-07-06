import bwipjs from "@bwip-js/node";
import { getAppUrl } from "@carbon/env";
import { Image, Text, View } from "@react-pdf/renderer";
import { generateQRCode } from "../../../qr/qr-code";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType
} from "../../../template";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { StockTransferData } from "./types";

async function generateBarcode(text: string): Promise<string> {
  const buffer = await bwipjs.toBuffer({
    bcid: "code128",
    text,
    scale: 3,
    height: 5,
    includetext: true,
    textxalign: "center"
  });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export function LineItemsBlock({
  block,
  data
}: {
  block: LineItemsBlockType;
  data: StockTransferData;
}) {
  const tw = useTw();
  const { stockTransferLines, thumbnails, theme } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);

  return (
    <View style={tw("mb-6 text-xs")}>
      <View
        style={[
          tw("flex flex-row py-2 px-3 text-[9px] font-bold"),
          { backgroundColor: theme.accent, color: theme.accentForeground }
        ]}
      >
        <Text style={tw("w-2/5 text-left")}>Description</Text>
        <Text style={tw("w-1/4 text-center")}>Transfer</Text>
        <Text style={tw("w-1/6 text-center")}>Qty</Text>
        <Text style={tw("w-1/8 text-center")}>Pick</Text>
      </View>

      {[...stockTransferLines]
        .sort((a, b) => {
          const storageUnitA = a.fromStorageUnitName || "Any";
          const storageUnitB = b.fromStorageUnitName || "Any";
          return storageUnitA.localeCompare(storageUnitB);
        })
        .map((line) => {
          const barcodeDataUrl = generateBarcode(line.itemReadableId ?? "");
          let pickUrl = `${getAppUrl()}/api/stock-transfer/${line.id}/pick`;
          if (line.requiresSerialTracking) {
            pickUrl += "?type=serial";
          } else if (line.requiresBatchTracking) {
            pickUrl += "?type=batch";
          }
          const pickQRCode = generateQRCode(pickUrl, 4);

          return (
            <View
              style={tw(
                "flex flex-row justify-between py-2 px-3 border-b border-gray-200 text-[10px]"
              )}
              key={line.id}
              wrap={false}
            >
              <View style={tw("w-2/5")}>
                <Text style={{ ...tw("font-bold mb-1"), ...overflow }}>
                  {line.itemDescription}
                </Text>
                <Text
                  style={{ ...tw("text-[9px] opacity-80 mb-2"), ...overflow }}
                >
                  {line.itemReadableId}
                </Text>
                {opts.showThumbnails &&
                  thumbnails &&
                  line.id != null &&
                  line.id in thumbnails &&
                  thumbnails[line.id] && (
                    <View style={tw("mt-2 mb-2")}>
                      <Image
                        src={thumbnails[line.id]!}
                        style={tw("w-1/4 h-auto max-w-[25%]")}
                      />
                    </View>
                  )}
                <Image src={barcodeDataUrl} style={tw("max-w-[50%]")} />
              </View>

              <View style={tw("w-1/4 text-center")}>
                <Text style={tw("text-xs")}>
                  {line.fromStorageUnitName || "Any"} →{" "}
                  {line.toStorageUnitName || "Any"}
                </Text>
              </View>

              <Text style={tw("w-1/6 text-center")}>
                {`${line.quantity} ${line.unitOfMeasure}`}
              </Text>

              <View style={tw("w-1/8 flex flex-col items-center")}>
                <Image src={pickQRCode} style={tw("h-16 w-16")} />
              </View>
            </View>
          );
        })}
    </View>
  );
}
