// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { formatPercent } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType,
  makeText,
  salesOrderTexts
} from "../../../template";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTaxableSubtotal,
  getLineTotal
} from "../../../utils/sales-order";
import { Note } from "../../components";
import { columnWidths } from "../columns";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { SalesOrderData } from "./types";

export function LineItemsBlock({
  block,
  data
}: {
  block: LineItemsBlockType;
  data: SalesOrderData;
}) {
  const tw = useTw();
  const {
    salesOrderLines,
    thumbnails,
    numberFormatter,
    rateFormatter,
    theme,
    locale
  } = data;
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
        {w.description ? (
          <Text style={{ width: w.description }}>{t("description")}</Text>
        ) : null}
        {w.qty ? (
          <Text style={[tw("text-center"), { width: w.qty }]}>{t("qty")}</Text>
        ) : null}
        {w.unitPrice ? (
          <Text style={[tw("text-center"), { width: w.unitPrice }]}>
            {t("unitPrice")}
          </Text>
        ) : null}
        {w.total ? (
          <Text style={[tw("text-center"), { width: w.total }]}>
            {t("total")}
          </Text>
        ) : null}
      </View>

      {salesOrderLines.map((line) => {
        const isEven = rowIndex % 2 === 0;
        rowIndex++;

        const lineAddOnCost = line.convertedAddOnCost ?? 0;
        const lineNonTaxableAddOnCost = line.convertedNonTaxableAddOnCost ?? 0;
        const lineShippingCost = line.convertedShippingCost ?? 0;
        const lineTaxPercent = line.taxPercent ?? 0;
        const lineTaxAmount = getLineTaxableSubtotal(line) * lineTaxPercent;
        const totalTaxAndFees =
          lineAddOnCost +
          lineNonTaxableAddOnCost +
          lineShippingCost +
          lineTaxAmount;

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
              {w.description ? (
                <View style={[tw("pr-2"), { width: w.description }]}>
                  <Text style={{ ...tw("text-gray-800"), ...overflow }}>
                    {getLineDescription(line)}
                  </Text>
                  <Text
                    style={{
                      ...tw("text-[9px] text-gray-600 mt-0.5"),
                      ...overflow
                    }}
                  >
                    {getLineDescriptionDetails(line)}
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
                  totalTaxAndFees > 0 ? (
                    <View style={tw("mt-1")}>
                      <Text style={tw("text-[9px] text-gray-600 font-bold")}>
                        {t("taxAndFees")}
                      </Text>
                      {lineShippingCost > 0 ? (
                        <View style={tw("flex flex-row justify-between")}>
                          <Text
                            style={tw("text-[9px] text-gray-600 flex-1 pr-2")}
                          >
                            {t("shipping")}
                          </Text>
                          <Text style={tw("text-[9px] text-gray-600")}>
                            {numberFormatter.format(lineShippingCost)}
                          </Text>
                        </View>
                      ) : null}
                      {lineAddOnCost > 0 ? (
                        <View style={tw("flex flex-row justify-between")}>
                          <Text
                            style={tw("text-[9px] text-gray-600 flex-1 pr-2")}
                          >
                            {t("addOn")}
                          </Text>
                          <Text style={tw("text-[9px] text-gray-600")}>
                            {numberFormatter.format(lineAddOnCost)}
                          </Text>
                        </View>
                      ) : null}
                      {lineNonTaxableAddOnCost > 0 ? (
                        <View style={tw("flex flex-row justify-between")}>
                          <Text
                            style={tw("text-[9px] text-gray-600 flex-1 pr-2")}
                          >
                            {t("nonTaxableAddOn")}
                          </Text>
                          <Text style={tw("text-[9px] text-gray-600")}>
                            {numberFormatter.format(lineNonTaxableAddOnCost)}
                          </Text>
                        </View>
                      ) : null}
                      {lineTaxPercent > 0 ? (
                        <View style={tw("flex flex-row justify-between")}>
                          <Text
                            style={tw("text-[9px] text-gray-600 flex-1 pr-2")}
                          >
                            {t("tax")} ({formatPercent(lineTaxPercent, locale)})
                          </Text>
                          <Text style={tw("text-[9px] text-gray-600")}>
                            {numberFormatter.format(lineTaxAmount)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}
              {w.qty ? (
                <Text
                  style={[tw("text-center text-gray-600"), { width: w.qty }]}
                >
                  {line.salesOrderLineType === "Comment"
                    ? ""
                    : `${line.saleQuantity} ${line.unitOfMeasureCode ?? "EA"}`}
                </Text>
              ) : null}
              {w.unitPrice ? (
                <Text
                  style={[
                    tw("text-center text-gray-600"),
                    { width: w.unitPrice }
                  ]}
                >
                  {line.salesOrderLineType === "Comment"
                    ? ""
                    : rateFormatter.format(line.convertedUnitPrice ?? 0)}
                </Text>
              ) : null}
              {w.total ? (
                <Text
                  style={[
                    tw("text-center text-gray-800 font-medium"),
                    { width: w.total }
                  ]}
                >
                  {line.salesOrderLineType === "Comment"
                    ? ""
                    : numberFormatter.format(getLineTotal(line))}
                </Text>
              ) : null}
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
