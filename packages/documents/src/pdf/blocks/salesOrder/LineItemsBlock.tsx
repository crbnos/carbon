// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Image, Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType,
  makeText,
  salesOrderTexts
} from "../../../template";
import { getLineTaxesAndFees } from "../../../utils/sales-order";
import { Note } from "../../components";
import { Cell, ChargeRow, TextCell } from "../Cell";
import { columnWidths } from "../columns";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { SalesOrderData } from "./types";
import { buildSalesOrderLineVars } from "./vars";

export function LineItemsBlock({
  block,
  data
}: {
  block: LineItemsBlockType;
  data: SalesOrderData;
}) {
  const tw = useTw();
  const { salesOrderLines, thumbnails, theme } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);
  const t = makeText(salesOrderTexts.lineItems, block, data.vars);
  const w = columnWidths(
    [
      { key: "description", width: 50 },
      { key: "qty", width: 100 / 6 },
      { key: "unitPrice", width: 100 / 6 },
      { key: "total", width: 100 / 6 }
    ],
    t.shows,
    "description"
  );
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
        <TextCell width={w.description}>{t("description")}</TextCell>
        <TextCell width={w.qty} style={tw("text-center")}>
          {t("qty")}
        </TextCell>
        <TextCell width={w.unitPrice} style={tw("text-center")}>
          {t("unitPrice")}
        </TextCell>
        <TextCell width={w.total} style={tw("text-center")}>
          {t("total")}
        </TextCell>
      </View>

      {salesOrderLines.map((line) => {
        const isEven = rowIndex % 2 === 0;
        rowIndex++;

        const row = data.values.row(
          "line",
          line.id,
          buildSalesOrderLineVars(line, rowIndex, data)
        );

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
              <Cell width={w.description} style={tw("pr-2")}>
                {/* Both stay when empty: the details margin holds the row's height. */}
                <Text style={{ ...tw("text-gray-800"), ...overflow }}>
                  {t.prints("descriptionCell", row)
                    ? t("descriptionCell", row)
                    : ""}
                </Text>
                <Text
                  style={{
                    ...tw("text-[9px] text-gray-600 mt-0.5"),
                    ...overflow
                  }}
                >
                  {t.prints("detailsCell", row) ? t("detailsCell", row) : ""}
                </Text>
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
                {line.salesOrderLineType !== "Comment" &&
                getLineTaxesAndFees(line) > 0 ? (
                  <View style={tw("mt-1")}>
                    <Text style={tw("text-[9px] text-gray-600 font-bold")}>
                      {t("taxAndFees")}
                    </Text>
                    {t.prints("shippingValue", row) ? (
                      <ChargeRow
                        label={t("shipping")}
                        value={t("shippingValue", row)}
                        textStyle="text-[9px] text-gray-600"
                      />
                    ) : null}
                    {t.prints("addOnValue", row) ? (
                      <ChargeRow
                        label={t("addOn")}
                        value={t("addOnValue", row)}
                        textStyle="text-[9px] text-gray-600"
                      />
                    ) : null}
                    {t.prints("nonTaxableAddOnValue", row) ? (
                      <ChargeRow
                        label={t("nonTaxableAddOn")}
                        value={t("nonTaxableAddOnValue", row)}
                        textStyle="text-[9px] text-gray-600"
                      />
                    ) : null}
                    {t.prints("taxValue", row) ? (
                      <ChargeRow
                        label={t("tax", row)}
                        value={t("taxValue", row)}
                        textStyle="text-[9px] text-gray-600"
                      />
                    ) : null}
                  </View>
                ) : null}
              </Cell>
              <TextCell width={w.qty} style={tw("text-center text-gray-600")}>
                {t("qtyCell", row)}
              </TextCell>
              <TextCell
                width={w.unitPrice}
                style={tw("text-center text-gray-600")}
              >
                {t("unitPriceCell", row)}
              </TextCell>
              <TextCell
                width={w.total}
                style={tw("text-center text-gray-800 font-medium")}
              >
                {t("totalCell", row)}
              </TextCell>
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
