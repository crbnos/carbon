// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import bwipjs from "@bwip-js/node";
import { getAppUrl } from "@carbon/env";
import { Image, Text, View } from "@react-pdf/renderer";
import { generateQRCode } from "../../../qr/qr-code";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType,
  makeText,
  stockTransferTexts
} from "../../../template";
import { Cell, TextCell } from "../Cell";
import { columnWidths } from "../columns";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { StockTransferData } from "./types";
import { buildStockTransferLineVars } from "./vars";

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
  const t = makeText(stockTransferTexts.lineItems, block, data.vars);
  const w = columnWidths(
    [
      { key: "description", width: 40 },
      { key: "transfer", width: 25 },
      { key: "qty", width: 100 / 6 },
      { key: "pick", width: 12.5 }
    ],
    t.shows,
    "description"
  );

  return (
    <View style={tw("mb-6 text-xs")}>
      <View
        style={[
          tw("flex flex-row py-2 px-3 text-[9px] font-bold"),
          { backgroundColor: theme.accent, color: theme.accentForeground }
        ]}
      >
        <TextCell width={w.description} style={tw("text-left")}>
          {t("description")}
        </TextCell>
        <TextCell width={w.transfer} style={tw("text-center")}>
          {t("transfer")}
        </TextCell>
        <TextCell width={w.qty} style={tw("text-center")}>
          {t("qty")}
        </TextCell>
        <TextCell width={w.pick} style={tw("text-center")}>
          {t("pick")}
        </TextCell>
      </View>

      {[...stockTransferLines]
        .sort((a, b) => {
          const storageUnitA = a.fromStorageUnitName || t("any");
          const storageUnitB = b.fromStorageUnitName || t("any");
          return storageUnitA.localeCompare(storageUnitB);
        })
        .map((line, index) => {
          const row = data.values.row(
            "line",
            line.id,
            buildStockTransferLineVars(line, index + 1, t("any"))
          );
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
              <Cell width={w.description}>
                <Text style={{ ...tw("font-bold mb-1"), ...overflow }}>
                  {t("descriptionCell", row)}
                </Text>
                <Text
                  style={{ ...tw("text-[9px] opacity-80 mb-2"), ...overflow }}
                >
                  {t("itemIdCell", row)}
                </Text>
                {opts.showThumbnails &&
                thumbnails &&
                line.id != null &&
                line.id in thumbnails &&
                thumbnails[line.id] ? (
                  <View style={tw("mt-2 mb-2")}>
                    <Image
                      src={thumbnails[line.id]!}
                      style={tw("w-1/4 h-auto max-w-[25%]")}
                    />
                  </View>
                ) : null}
                <Image src={barcodeDataUrl} style={tw("max-w-[50%]")} />
              </Cell>

              <Cell width={w.transfer} style={tw("text-center")}>
                <Text style={tw("text-xs")}>{t("transferCell", row)}</Text>
              </Cell>

              <TextCell width={w.qty} style={tw("text-center")}>
                {t("qtyCell", row)}
              </TextCell>

              <Cell width={w.pick} style={tw("flex flex-col items-center")}>
                <Image src={pickQRCode} style={tw("h-16 w-16")} />
              </Cell>
            </View>
          );
        })}
    </View>
  );
}
