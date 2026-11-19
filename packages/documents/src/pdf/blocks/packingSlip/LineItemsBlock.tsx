// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import bwipjs from "@bwip-js/node";
import type { Database } from "@carbon/database";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import { generateQRCode } from "../../../qr/qr-code";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType,
  makeText,
  packingSlipTexts
} from "../../../template";
import { Cell, TextCell } from "../Cell";
import { columnWidths } from "../columns";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { PackingSlipData } from "./types";
import {
  buildPackingSlipLineVars,
  buildPackingSlipRentalUnitVars
} from "./vars";

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
  const t = makeText(packingSlipTexts.lineItems, block, data.vars);
  let rowIndex = 0;

  // A rental shipment lists its units instead of shipment lines: one unit per
  // row, with its serial number.
  if (data.rentalUnits && data.rentalUnits.length > 0) {
    const rw = columnWidths(
      [
        { key: "rentalDescription", width: 50 },
        { key: "rentalQty", width: 100 / 6 },
        { key: "serial", width: 100 / 3 }
      ],
      t.shows,
      "rentalDescription"
    );
    return (
      <View style={tw("mb-4")}>
        <View
          style={[
            tw("flex flex-row py-2 px-3 text-[9px] font-bold"),
            { backgroundColor: theme.accent, color: theme.accentForeground }
          ]}
        >
          <TextCell width={rw.rentalDescription} style={tw("text-left")}>
            {t("rentalDescription")}
          </TextCell>
          <TextCell width={rw.rentalQty} style={tw("text-right")}>
            {t("rentalQty")}
          </TextCell>
          <TextCell width={rw.serial} style={tw("text-right")}>
            {t("serial")}
          </TextCell>
        </View>
        {data.rentalUnits.map((unit, index) => {
          const rowBg =
            !opts.zebra || index % 2 === 0 ? "bg-white" : "bg-gray-50";
          const row = data.values.row(
            "unit",
            unit.id,
            buildPackingSlipRentalUnitVars(unit)
          );
          return (
            <View
              key={unit.id}
              style={tw(
                `flex flex-row py-2 px-3 border-b border-gray-200 text-[10px] ${rowBg}`
              )}
              wrap={false}
            >
              <Cell width={rw.rentalDescription} style={tw("pr-2")}>
                <Text style={{ ...tw("text-gray-800"), ...overflow }}>
                  {t("rentalNameCell", row)}
                </Text>
                {t.prints("rentalAssetCell", row) ? (
                  <Text
                    style={{
                      ...tw("text-[8px] text-gray-400 mt-0.5"),
                      ...overflow
                    }}
                  >
                    {t("rentalAssetCell", row)}
                  </Text>
                ) : null}
              </Cell>
              <TextCell
                width={rw.rentalQty}
                style={tw("text-right text-gray-600")}
              >
                {t("rentalQtyCell", row)}
              </TextCell>
              <TextCell
                width={rw.serial}
                style={tw("text-right text-gray-600")}
              >
                {t("serialCell", row)}
              </TextCell>
            </View>
          );
        })}
      </View>
    );
  }

  // Without tracked entities the serial column is absent and the table is
  // 9/12 wide, as before.
  const w = columnWidths(
    [
      { key: "description", width: hasTrackedEntities ? 500 / 12 : 700 / 12 },
      { key: "qty", width: 100 / 6 },
      ...(hasTrackedEntities
        ? [{ key: "serialBatch" as const, width: 500 / 12 }]
        : [])
    ],
    t.shows,
    "description"
  );

  return (
    <View style={tw("mb-4")}>
      <View
        style={[
          tw("flex flex-row py-2 px-3 text-[9px] font-bold"),
          { backgroundColor: theme.accent, color: theme.accentForeground }
        ]}
      >
        <TextCell width={w.description} style={tw("text-left")}>
          {t("description")}
        </TextCell>
        <TextCell width={w.qty} style={tw("text-right")}>
          {t("qty")}
        </TextCell>
        <TextCell width={w.serialBatch} style={tw("text-right")}>
          {t("serialBatch")}
        </TextCell>
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
          const row = data.values.row(
            "line",
            line.id,
            buildPackingSlipLineVars(
              line,
              trackedEntitiesForLine.map((entity) => entity.id)
            )
          );

          return (
            <View
              key={line.id}
              style={tw(
                `flex flex-row py-2 px-3 border-b border-gray-200 text-[10px] ${rowBg}`
              )}
              wrap={false}
            >
              <Cell width={w.description} style={tw("pr-2")}>
                <Text style={{ ...tw("text-gray-800"), ...overflow }}>
                  {t("itemCell", row)}
                </Text>
                <Text
                  style={{
                    ...tw("text-[8px] text-gray-400 mt-0.5"),
                    ...overflow
                  }}
                >
                  {t("descriptionCell", row)}
                </Text>
                {opts.showThumbnails &&
                thumbnails &&
                line.id != null &&
                line.id in thumbnails &&
                thumbnails[line.id] ? (
                  <View style={tw("mt-1 w-16")}>
                    <Image
                      src={thumbnails[line.id]!}
                      style={tw("w-full h-auto")}
                    />
                  </View>
                ) : null}
                <View style={tw("mt-1")}>
                  <Image src={barcodeDataUrl} style={tw("max-w-[50%]")} />
                </View>
              </Cell>
              <TextCell width={w.qty} style={tw("text-right text-gray-600")}>
                {t("qtyCell", row)}
              </TextCell>
              <Cell
                width={w.serialBatch}
                style={tw("flex flex-col gap-1 items-end")}
              >
                {trackedEntitiesForLine.map((entity) => {
                  const qrCodeDataUrl = generateQRCode(entity.id, 8);
                  return (
                    <View
                      key={entity.id}
                      style={tw("mb-1 flex flex-row items-center gap-1")}
                    >
                      <Text style={tw("text-[8px] text-gray-600")}>
                        {t("serialBatchCell", {
                          ...row,
                          "line.serialBatch": entity.id
                        })}
                      </Text>
                      <Image
                        src={qrCodeDataUrl}
                        style={{ width: 24, height: 24 }}
                      />
                    </View>
                  );
                })}
              </Cell>
            </View>
          );
        })}
    </View>
  );
}
