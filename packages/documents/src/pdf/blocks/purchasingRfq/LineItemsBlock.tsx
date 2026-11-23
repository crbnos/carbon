// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Image, Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType,
  makeText,
  purchasingRfqTexts
} from "../../../template";
import { Note } from "../../components";
import { TextCell } from "../Cell";
import { columnWidths } from "../columns";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { PurchasingRfqData } from "./types";
import { buildPurchasingRfqLineVars, formatQuantityBreaks } from "./vars";

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
  const t = makeText(purchasingRfqTexts.lineItems, block, data.vars);
  const w = columnWidths(
    [
      { key: "number", width: 7 },
      { key: "item", width: 59 },
      { key: "quantity", width: 20 },
      { key: "unit", width: 14 }
    ],
    t.shows,
    "item"
  );
  // The last visible column has no rule of its own: the row's border closes it.
  const lastColumn = (["unit", "quantity", "item", "number"] as const).find(
    (key) => w[key]
  );

  const cell = { borderRightWidth: 0.5, borderColor: RULE };
  const rule = (key: keyof typeof w) => (key === lastColumn ? {} : cell);
  // Each row carries its own rules: a border on the table's wrapper is drawn
  // to the bottom of the page when the table breaks across pages.
  const rowRules = {
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: RULE
  };
  const columns = {
    number: [
      tw("px-2 py-1.5 text-center"),
      { width: w.number },
      rule("number")
    ],
    item: [tw("px-2 py-1.5"), { width: w.item }, rule("item")],
    quantity: [
      tw("px-2 py-1.5 text-right"),
      { width: w.quantity },
      rule("quantity")
    ],
    unit: [tw("px-2 py-1.5"), { width: w.unit }, rule("unit")]
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
        <TextCell width={w.number} style={columns.number}>
          {t("number")}
        </TextCell>
        <TextCell width={w.item} style={columns.item}>
          {t("item")}
        </TextCell>
        <TextCell width={w.quantity} style={columns.quantity}>
          {t("quantity")}
        </TextCell>
        <TextCell width={w.unit} style={columns.unit}>
          {t("unit")}
        </TextCell>
      </View>

      {purchasingRfqLines.map((line, index) => {
        const notes = (line.externalNotes ?? {}) as JSONContent;
        const thumbnail = line.id ? thumbnails?.[line.id] : null;
        const row = data.values.row(
          "line",
          line.id,
          buildPurchasingRfqLineVars(line, index + 1, data)
        );
        const quantities = formatQuantityBreaks(line, locale);

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
            <TextCell width={w.number} style={columns.number}>
              {t("numberCell", row)}
            </TextCell>
            {w.item ? (
              <View style={columns.item}>
                <Text style={{ ...tw("font-bold"), ...overflow }}>
                  {t("itemCell", row)}
                </Text>
                {t.prints("descriptionCell", row) ? (
                  <Text style={{ ...tw("mt-0.5"), ...overflow }}>
                    {t("descriptionCell", row)}
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
            ) : null}
            {w.quantity ? (
              <View style={columns.quantity}>
                {quantities.map((quantity, qtyIndex) => (
                  <Text key={qtyIndex}>
                    {t("quantityCell", { ...row, "line.quantity": quantity })}
                  </Text>
                ))}
              </View>
            ) : null}
            {w.unit ? (
              <View style={columns.unit}>
                {quantities.map((quantity, qtyIndex) => (
                  <Text key={qtyIndex}>
                    {t("unitCell", { ...row, "line.quantity": quantity })}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
