// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Image, Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType,
  makeText,
  quoteTexts
} from "../../../template";
import { Note } from "../../components";
import { Cell, ChargeRow, TextCell } from "../Cell";
import { columnWidths } from "../columns";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { QuoteData } from "./types";
import {
  buildQuoteChargeVars,
  buildQuoteLineVars,
  buildQuotePriceVars,
  getQuotePriceAmounts
} from "./vars";

export function LineItemsBlock({
  block,
  data
}: {
  block: LineItemsBlockType;
  data: QuoteData;
}) {
  const tw = useTw();
  const {
    quoteLines,
    hasSinglePricePerLine,
    hasAnyLeadTime,
    thumbnails,
    theme
  } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);
  const t = makeText(quoteTexts.lineItems, block, data.vars);
  // Description takes a third of the row; the other columns share the rest.
  const numberColumns: (
    | "qty"
    | "unitPrice"
    | "columnTaxAndFees"
    | "leadTime"
    | "total"
  )[] = [
    "qty",
    "unitPrice",
    ...(!hasSinglePricePerLine ? (["columnTaxAndFees"] as const) : []),
    ...(hasAnyLeadTime ? (["leadTime"] as const) : []),
    "total"
  ];
  const w = columnWidths(
    [
      { key: "description", width: 100 / 3 },
      ...numberColumns.map((key) => ({
        key,
        width: 200 / 3 / numberColumns.length
      }))
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
        <Cell width={w.description}>
          <Text>{t("description")}</Text>
        </Cell>
        <TextCell width={w.qty} style={tw("text-center pr-3")}>
          {t("qty")}
        </TextCell>
        <TextCell width={w.unitPrice} style={tw("text-center pr-3")}>
          {t("unitPrice")}
        </TextCell>
        <TextCell width={w.columnTaxAndFees} style={tw("text-center pr-3")}>
          {t("columnTaxAndFees")}
        </TextCell>
        <TextCell width={w.leadTime} style={tw("text-center pr-3")}>
          {t("leadTime")}
        </TextCell>
        <TextCell width={w.total} style={tw("text-center")}>
          {t("total")}
        </TextCell>
      </View>

      {quoteLines.map((line, lineIndex) => {
        const lineRow = data.values.row(
          "line",
          line.id,
          buildQuoteLineVars(line, lineIndex + 1)
        );
        const additionalCharges = line.additionalCharges ?? {};

        return (
          <View key={line.id}>
            <>
              {[...(line.quantity ?? [])]
                .sort((a, b) => a - b)
                .map((quantity, index) => {
                  const isEven = rowIndex % 2 === 0;
                  rowIndex++;

                  const row = data.values.row(
                    "price",
                    `${line.id}:${quantity}`,
                    buildQuotePriceVars(line, quantity, data)
                  );
                  const { totalTaxAndFees } = getQuotePriceAmounts(
                    line,
                    quantity,
                    data
                  );

                  return (
                    <View
                      key={`${line.id}-${quantity}`}
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
                        {index === 0 ? (
                          <>
                            {/* Both stay when empty: the details margin holds the row's height. */}
                            <Text
                              style={{ ...tw("text-gray-800"), ...overflow }}
                            >
                              {t.prints("descriptionCell", lineRow)
                                ? t("descriptionCell", lineRow)
                                : ""}
                            </Text>
                            <Text
                              style={{
                                ...tw("text-[8px] text-gray-400 mt-0.5"),
                                ...overflow
                              }}
                            >
                              {t.prints("detailsCell", lineRow)
                                ? t("detailsCell", lineRow)
                                : ""}
                            </Text>
                            {opts.showThumbnails &&
                            thumbnails &&
                            line.id != null &&
                            thumbnails[line.id] ? (
                              <View style={tw("mt-2")}>
                                <Image
                                  src={thumbnails[line.id]!}
                                  style={{ width: 60, height: 60 }}
                                />
                              </View>
                            ) : null}
                            {totalTaxAndFees > 0 ? (
                              <View style={tw("mt-1")}>
                                <Text
                                  style={tw(
                                    "text-[8px] text-gray-400 font-bold"
                                  )}
                                >
                                  {t("lineTaxAndFees")}
                                </Text>
                                {t.prints("shippingValue", row) ? (
                                  <ChargeRow
                                    label={t("shipping")}
                                    value={t("shippingValue", row)}
                                    textStyle="text-[8px] text-gray-400"
                                  />
                                ) : null}
                                {Object.entries(additionalCharges)
                                  .filter(
                                    ([, charge]) =>
                                      charge.description &&
                                      (charge.amounts?.[quantity] ?? 0) > 0
                                  )
                                  .sort(([, a], [, b]) =>
                                    a.description.localeCompare(b.description)
                                  )
                                  .map(([chargeId, charge]) => {
                                    const chargeRow = data.values.row(
                                      "charge",
                                      `${line.id}:${quantity}:${chargeId}`,
                                      buildQuoteChargeVars(
                                        charge,
                                        quantity,
                                        data
                                      )
                                    );
                                    return (
                                      <ChargeRow
                                        key={chargeId}
                                        label={t("charge", chargeRow)}
                                        value={t("chargeValue", chargeRow)}
                                        textStyle="text-[8px] text-gray-400"
                                      />
                                    );
                                  })}
                                {t.prints("taxValue", row) ? (
                                  <ChargeRow
                                    label={t("tax", row)}
                                    value={t("taxValue", row)}
                                    textStyle="text-[8px] text-gray-400"
                                  />
                                ) : null}
                              </View>
                            ) : null}
                          </>
                        ) : null}
                      </Cell>
                      <TextCell
                        width={w.qty}
                        style={tw("text-center text-gray-600 pr-3")}
                      >
                        {t("qtyCell", row)}
                      </TextCell>
                      <TextCell
                        width={w.unitPrice}
                        style={tw("text-center text-gray-600 pr-3")}
                      >
                        {t("unitPriceCell", row)}
                      </TextCell>
                      <TextCell
                        width={w.columnTaxAndFees}
                        style={tw("text-center text-gray-600 pr-3")}
                      >
                        {t("columnTaxAndFeesCell", row)}
                      </TextCell>
                      <TextCell
                        width={w.leadTime}
                        style={tw("text-center text-gray-600 pr-3")}
                      >
                        {t("leadTimeCell", row)}
                      </TextCell>
                      <TextCell
                        width={w.total}
                        style={tw("text-center text-gray-800 font-medium")}
                      >
                        {t("totalCell", row)}
                      </TextCell>
                    </View>
                  );
                })}
              {Object.keys(line.externalNotes ?? {}).length > 0 ? (
                <View style={tw("px-3 py-2 border-b border-gray-200")}>
                  <Note
                    key={`${line.id}-notes`}
                    content={line.externalNotes as JSONContent}
                  />
                </View>
              ) : null}
            </>
          </View>
        );
      })}
    </View>
  );
}
