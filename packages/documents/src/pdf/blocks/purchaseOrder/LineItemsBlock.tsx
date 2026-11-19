// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Image, Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType,
  makeText,
  purchaseOrderTexts
} from "../../../template";
import { Note } from "../../components";
import { Cell, TextCell } from "../Cell";
import { columnWidths } from "../columns";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { PurchaseOrderData } from "./types";
import { buildPurchaseOrderLineVars } from "./vars";

/**
 * The purchase order's line table. Each row prints the item ID (an indirect
 * line prints its description), then the supplier's part number on its own
 * line when the template's `showSupplierPartId` option is on.
 */
export function LineItemsBlock({
  block,
  data
}: {
  block: LineItemsBlockType;
  data: PurchaseOrderData;
}) {
  const tw = useTw();
  const { purchaseOrderLines, thumbnails, theme } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);
  const t = makeText(purchaseOrderTexts.lineItems, block, data.vars);
  const w = columnWidths(
    [
      { key: "number", width: 4 },
      { key: "description", width: 22 },
      { key: "qty", width: 8 },
      { key: "uom", width: 7 },
      { key: "required", width: 10 },
      { key: "unitPrice", width: 12 },
      { key: "netValue", width: 12 },
      { key: "taxValue", width: 12 },
      { key: "total", width: 13 }
    ],
    t.shows,
    "description"
  );
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
        <TextCell width={w.number} style={tw("text-center")}>
          {t("number")}
        </TextCell>
        <TextCell width={w.description}>{t("description")}</TextCell>
        <TextCell width={w.qty} style={tw("text-center")}>
          {t("qty")}
        </TextCell>
        <TextCell width={w.uom} style={tw("text-center")}>
          {t("uom")}
        </TextCell>
        <Cell width={w.required} style={tw("items-center")}>
          <Text>{t("required")}</Text>
        </Cell>
        <TextCell width={w.unitPrice} style={tw("text-center")}>
          {t("unitPrice")}
        </TextCell>
        <TextCell width={w.netValue} style={tw("text-center")}>
          {t("netValue")}
        </TextCell>
        <TextCell width={w.taxValue} style={tw("text-center")}>
          {t("taxValue")}
        </TextCell>
        <TextCell width={w.total} style={tw("text-center")}>
          {t("total")}
        </TextCell>
      </View>

      {purchaseOrderLines.map((line) => {
        const isEven = rowIndex % 2 === 0;
        rowIndex++;

        const row = data.values.row(
          "line",
          line.id,
          buildPurchaseOrderLineVars(line, rowIndex, data)
        );

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
                <TextCell
                  width={w.number}
                  style={tw("text-center text-gray-400")}
                >
                  {t("numberCell", row)}
                </TextCell>
                <Cell width={w.description} style={tw("pr-2")}>
                  {t.prints("descriptionCell", row) ? (
                    <Text style={{ ...tw("text-gray-900"), ...overflow }}>
                      {t("descriptionCell", row)}
                    </Text>
                  ) : null}
                  {t.prints("detailsCell", row) ? (
                    <Text
                      style={{
                        ...tw("text-[7px] text-gray-600 mt-0.5"),
                        ...overflow
                      }}
                    >
                      {t("detailsCell", row)}
                    </Text>
                  ) : null}
                  {opts.showSupplierPartId &&
                  t.prints("supplierPartCell", row) ? (
                    <Text style={tw("text-[7px] text-gray-600 mt-0.5")}>
                      {t("supplierPartCell", row)}
                    </Text>
                  ) : null}
                  {t.prints("operationCell", row) ? (
                    <Text style={tw("text-[7px] text-gray-600 mt-0.5")}>
                      {t("operationCell", row)}
                    </Text>
                  ) : null}
                  {opts.showThumbnails &&
                  thumbnails &&
                  line.id &&
                  line.id in thumbnails &&
                  thumbnails[line.id] ? (
                    <View style={tw("mt-1 w-16")}>
                      <Image
                        src={thumbnails[line.id]!}
                        style={tw("w-full h-auto")}
                      />
                    </View>
                  ) : null}
                  {t.prints("shipping", row) ? (
                    <Text style={tw("text-[7px] text-gray-600 mt-0.5")}>
                      {t("shipping", row)}
                    </Text>
                  ) : null}
                </Cell>
                <TextCell width={w.qty} style={tw("text-center text-gray-600")}>
                  {t("qtyCell", row)}
                </TextCell>
                <TextCell width={w.uom} style={tw("text-center text-gray-600")}>
                  {t("uomCell", row)}
                </TextCell>
                <TextCell
                  width={w.required}
                  style={tw("text-center text-gray-600")}
                >
                  {t("requiredCell", row)}
                </TextCell>
                <TextCell
                  width={w.unitPrice}
                  style={tw("text-center text-gray-600")}
                >
                  {t("unitPriceCell", row)}
                </TextCell>
                <TextCell
                  width={w.netValue}
                  style={tw("text-center text-gray-600")}
                >
                  {t("netValueCell", row)}
                </TextCell>
                <Cell width={w.taxValue}>
                  <View style={tw("flex flex-col items-center")}>
                    {t.prints("taxValueCell", row) ? (
                      <Text style={tw("text-gray-600")}>
                        {t("taxValueCell", row)}
                      </Text>
                    ) : null}
                    {t.prints("taxPercentCell", row) ? (
                      <Text style={tw("text-[6px] text-gray-400")}>
                        {t("taxPercentCell", row)}
                      </Text>
                    ) : null}
                  </View>
                </Cell>
                <TextCell
                  width={w.total}
                  style={tw("text-center text-gray-800 font-medium")}
                >
                  {t("totalCell", row)}
                </TextCell>
              </View>
            </View>
            {Object.keys(line.externalNotes ?? {}).length > 0 ? (
              <View style={tw("px-3 py-2 border-b border-gray-200")}>
                <Note
                  key={`${line.id}-notes`}
                  content={line.externalNotes as JSONContent}
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
