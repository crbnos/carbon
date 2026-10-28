// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { distinctItemText } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType
} from "../../../template";
import { Note } from "../../components";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { PurchasingRfqData, PurchasingRfqPdfLine } from "./types";

/** The quantity breaks a supplier prices; a line with none asks for one. */
function quantitiesOf(line: PurchasingRfqPdfLine): number[] {
  return Array.isArray(line.quantity) && line.quantity.length > 0
    ? line.quantity
    : [1];
}

export function LineItemsBlock({
  block,
  data
}: {
  block: LineItemsBlockType;
  data: PurchasingRfqData;
}) {
  const tw = useTw();
  const { purchasingRfqLines, thumbnails, theme } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);
  // The supplier writes the price and lead time in by hand.
  const blank = tw("border-b border-gray-400 h-[12px] mx-2");

  return (
    <View style={tw("mb-4")}>
      <View
        fixed
        style={[
          tw("flex flex-row py-2 px-3 text-[9px] font-bold items-center"),
          { backgroundColor: theme.accent, color: theme.accentForeground }
        ]}
      >
        <Text style={tw("w-[5%] text-center")}>#</Text>
        <Text style={tw("w-[35%]")}>Item</Text>
        <Text style={tw("w-[12%] text-center")}>Qty</Text>
        <Text style={tw("w-[8%] text-center")}>UOM</Text>
        <Text style={tw("w-[14%] text-center")}>Unit Price</Text>
        <Text style={tw("w-[12%] text-center")}>Lead Time</Text>
        <Text style={tw("w-[14%] text-center")}>Total</Text>
      </View>

      {purchasingRfqLines.map((line, index) => {
        const notes = (line.externalNotes ?? {}) as JSONContent;
        const thumbnail = line.id ? thumbnails?.[line.id] : null;
        const quantities = quantitiesOf(line);

        return (
          <View
            key={line.id ?? index}
            wrap={false}
            style={[
              tw("flex flex-col py-2 px-3 border-b border-gray-200 text-[9px]"),
              {
                backgroundColor:
                  opts.zebra && index % 2 === 1
                    ? "rgba(249, 250, 251, 0.6)"
                    : "transparent"
              }
            ]}
          >
            <View style={tw("flex flex-row")}>
              <Text style={tw("w-[5%] text-center text-gray-600")}>
                {index + 1}
              </Text>
              <View style={tw("w-[35%] pr-2")}>
                <Text style={{ ...tw("text-gray-800"), ...overflow }}>
                  {line.itemReadableId ?? ""}
                </Text>
                {distinctItemText(line.itemReadableId, line.description) ? (
                  <Text
                    style={{
                      ...tw("text-[8px] text-gray-600 mt-0.5"),
                      ...overflow
                    }}
                  >
                    {line.description}
                  </Text>
                ) : null}
                {opts.showThumbnails && thumbnail ? (
                  <View style={tw("mt-1 w-16")}>
                    <Image src={thumbnail} style={tw("w-full h-auto")} />
                  </View>
                ) : null}
              </View>
              <View style={tw("w-[60%] flex flex-col")}>
                {quantities.map((quantity, qtyIndex) => (
                  <View
                    key={qtyIndex}
                    style={tw(
                      `flex flex-row items-end ${qtyIndex > 0 ? "mt-2" : ""}`
                    )}
                  >
                    <Text style={tw("w-[20%] text-center text-gray-800")}>
                      {quantity}
                    </Text>
                    <Text style={tw("w-[13.33%] text-center text-gray-600")}>
                      {line.purchaseUnitOfMeasureCode ??
                        line.inventoryUnitOfMeasureCode ??
                        ""}
                    </Text>
                    <View style={tw("w-[23.33%]")}>
                      <View style={blank} />
                    </View>
                    <View style={tw("w-[20%]")}>
                      <View style={blank} />
                    </View>
                    <View style={tw("w-[23.33%]")}>
                      <View style={blank} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
            {Object.keys(notes).length > 0 ? (
              <View style={tw("mt-1 pl-[5%] text-[8px] text-gray-600")}>
                <Note content={notes} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
