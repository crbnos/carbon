// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { distinctItemText, formatQuantity } from "@carbon/utils";
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

const RULE = "#9ca3af";
const HEADER_FILL = "#f3f4f6";
const ZEBRA_FILL = "#f9fafb";

/**
 * The items to quote, as a plain ruled table: the part, then each quantity
 * break on its own line with its unit. No price columns — the supplier quotes
 * in their own format.
 */
export function LineItemsBlock({
  block,
  data
}: {
  block: LineItemsBlockType;
  data: PurchasingRfqData;
}) {
  const tw = useTw();
  const { purchasingRfqLines, thumbnails, locale } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);

  const cell = { borderRightWidth: 0.5, borderColor: RULE };
  // Each row carries its own rules: a border on the table's wrapper is drawn
  // to the bottom of the page when the table breaks across pages.
  const rowRules = {
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: RULE
  };
  const columns = {
    index: [tw("w-[7%] px-2 py-1.5 text-center"), cell],
    item: [tw("w-[59%] px-2 py-1.5"), cell],
    quantity: [tw("w-[20%] px-2 py-1.5 text-right"), cell],
    unit: tw("w-[14%] px-2 py-1.5")
  };

  return (
    <View style={tw("mb-5 text-[9px] text-gray-800")}>
      <View
        fixed
        style={[
          tw("flex flex-row font-bold"),
          { backgroundColor: HEADER_FILL, borderTopWidth: 0.5 },
          rowRules
        ]}
      >
        <Text style={columns.index}>#</Text>
        <Text style={columns.item}>Item</Text>
        <Text style={columns.quantity}>Quantity</Text>
        <Text style={columns.unit}>Unit</Text>
      </View>

      {purchasingRfqLines.map((line, index) => {
        const notes = (line.externalNotes ?? {}) as JSONContent;
        const thumbnail = line.id ? thumbnails?.[line.id] : null;
        const quantities = quantitiesOf(line);
        const unit =
          line.purchaseUnitOfMeasureCode ??
          line.inventoryUnitOfMeasureCode ??
          "";

        return (
          <View
            key={line.id ?? index}
            wrap={false}
            style={[
              tw("flex flex-row"),
              rowRules,
              opts.zebra && index % 2 === 1
                ? { backgroundColor: ZEBRA_FILL }
                : {}
            ]}
          >
            <Text style={columns.index}>{index + 1}</Text>
            <View style={columns.item}>
              <Text style={{ ...tw("font-bold"), ...overflow }}>
                {line.itemReadableId ?? ""}
              </Text>
              {distinctItemText(line.itemReadableId, line.description) ? (
                <Text style={{ ...tw("mt-0.5"), ...overflow }}>
                  {line.description}
                </Text>
              ) : null}
              {Object.keys(notes).length > 0 ? (
                <View style={tw("mt-1 text-gray-600")}>
                  <Note content={notes} />
                </View>
              ) : null}
              {opts.showThumbnails && thumbnail ? (
                <View style={tw("mt-1 w-16")}>
                  <Image src={thumbnail} style={tw("w-full h-auto")} />
                </View>
              ) : null}
            </View>
            <View style={columns.quantity}>
              {quantities.map((quantity, qtyIndex) => (
                <Text key={qtyIndex}>{formatQuantity(quantity, locale)}</Text>
              ))}
            </View>
            <View style={columns.unit}>
              {quantities.map((_, qtyIndex) => (
                <Text key={qtyIndex}>{unit}</Text>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
