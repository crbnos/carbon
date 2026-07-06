import bwipjs from "@bwip-js/node";
import type { Database } from "@carbon/database";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import { generateQRCode } from "../../../qr/qr-code";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType
} from "../../../template";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { PackingSlipData } from "./types";

type ShipmentLine = Database["public"]["Views"]["shipmentLines"]["Row"];

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
  data: PackingSlipData;
}) {
  const tw = useTw();
  const { shipmentLines, trackedEntities, thumbnails, theme } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);
  const hasTrackedEntities = trackedEntities.length > 0;
  let rowIndex = 0;

  return (
    <View style={tw("mb-4")}>
      <View
        style={[
          tw("flex flex-row py-2 px-3 text-[9px] font-bold"),
          { backgroundColor: theme.accent, color: theme.accentForeground }
        ]}
      >
        <Text style={tw(`w-${hasTrackedEntities ? "5/12" : "7/12"} text-left`)}>
          Description
        </Text>
        <Text style={tw("w-2/12 text-right")}>Qty</Text>
        {hasTrackedEntities && (
          <Text style={tw("w-5/12 text-right")}>Serial/Batch</Text>
        )}
      </View>

      {shipmentLines
        .filter((line) => (line?.shippedQuantity ?? 0) > 0)
        .map((line: ShipmentLine) => {
          const barcodeDataUrl = generateBarcode(line?.itemReadableId || "");
          const trackedEntitiesForLine = trackedEntities.filter(
            (entity) =>
              (entity.attributes as TrackedEntityAttributes)?.[
                "Shipment Line"
              ] === line.id
          );
          const isEven = rowIndex % 2 === 0;
          rowIndex++;
          const rowBg = !opts.zebra || isEven ? "bg-white" : "bg-gray-50";

          return (
            <View
              key={line.id}
              style={tw(
                `flex flex-row py-2 px-3 border-b border-gray-200 text-[10px] ${rowBg}`
              )}
              wrap={false}
            >
              <View
                style={tw(`w-${hasTrackedEntities ? "5/12" : "7/12"} pr-2`)}
              >
                <Text style={{ ...tw("text-gray-800"), ...overflow }}>
                  {line.itemReadableId}
                </Text>
                <Text
                  style={{
                    ...tw("text-[8px] text-gray-400 mt-0.5"),
                    ...overflow
                  }}
                >
                  {line.description}
                </Text>
                {opts.showThumbnails &&
                  thumbnails &&
                  line.id != null &&
                  line.id in thumbnails &&
                  thumbnails[line.id] && (
                    <View style={tw("mt-1 w-16")}>
                      <Image
                        src={thumbnails[line.id]!}
                        style={tw("w-full h-auto")}
                      />
                    </View>
                  )}
                <View style={tw("mt-1")}>
                  <Image src={barcodeDataUrl} style={tw("max-w-[50%]")} />
                </View>
              </View>
              <Text style={tw("w-2/12 text-right text-gray-600")}>
                {`${line.shippedQuantity} / ${line.orderQuantity} ${line.unitOfMeasure}`}
              </Text>
              {hasTrackedEntities && (
                <View style={tw("w-5/12 flex flex-col gap-1 items-end")}>
                  {trackedEntitiesForLine.map((entity) => {
                    const qrCodeDataUrl = generateQRCode(entity.id, 8);
                    return (
                      <View
                        key={entity.id}
                        style={tw("mb-1 flex flex-row items-center gap-1")}
                      >
                        <Text style={tw("text-[8px] text-gray-600")}>
                          {entity.id}
                        </Text>
                        <Image
                          src={qrCodeDataUrl}
                          style={{ width: 24, height: 24 }}
                        />
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
    </View>
  );
}
