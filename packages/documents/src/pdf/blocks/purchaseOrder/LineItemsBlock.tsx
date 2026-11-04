// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType,
  makeText,
  purchaseOrderTexts
} from "../../../template";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTotal
} from "../../../utils/purchase-order";
import { formatTaxPercent } from "../../../utils/shared";
import { Note } from "../../components";
import { columnWidths } from "../columns";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { PurchaseOrderData } from "./types";

const INDIRECT_TYPES = new Set([
  "Service",
  "G/L Account",
  "Fixed Asset",
  "Comment"
]);
const isIndirect = (t: string | null | undefined) =>
  !!t && INDIRECT_TYPES.has(t);

export function LineItemsBlock({
  block,
  data
}: {
  block: LineItemsBlockType;
  data: PurchaseOrderData;
}) {
  const tw = useTw();
  const {
    purchaseOrder,
    purchaseOrderLines,
    thumbnails,
    numberFormatter,
    rateFormatter,
    theme,
    locale
  } = data;
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
        {w.number ? (
          <Text style={[tw("text-center"), { width: w.number }]}>
            {t("number")}
          </Text>
        ) : null}
        {w.description ? (
          <Text style={{ width: w.description }}>{t("description")}</Text>
        ) : null}
        {w.qty ? (
          <Text style={[tw("text-center"), { width: w.qty }]}>{t("qty")}</Text>
        ) : null}
        {w.uom ? (
          <Text style={[tw("text-center"), { width: w.uom }]}>{t("uom")}</Text>
        ) : null}
        {w.required ? (
          <View style={[tw("items-center"), { width: w.required }]}>
            <Text>{t("required")}</Text>
          </View>
        ) : null}
        {w.unitPrice ? (
          <Text style={[tw("text-center"), { width: w.unitPrice }]}>
            {t("unitPrice")}
          </Text>
        ) : null}
        {w.netValue ? (
          <Text style={[tw("text-center"), { width: w.netValue }]}>
            {t("netValue")}
          </Text>
        ) : null}
        {w.taxValue ? (
          <Text style={[tw("text-center"), { width: w.taxValue }]}>
            {t("taxValue")}
          </Text>
        ) : null}
        {w.total ? (
          <Text style={[tw("text-center"), { width: w.total }]}>
            {t("total")}
          </Text>
        ) : null}
      </View>

      {purchaseOrderLines.map((line) => {
        const isEven = rowIndex % 2 === 0;
        rowIndex++;

        const netValue =
          (line.purchaseQuantity ?? 0) * (line.supplierUnitPrice ?? 0);
        const taxPercentLabel = formatTaxPercent(line.taxPercent, locale);

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
                {w.number ? (
                  <Text
                    style={[
                      tw("text-center text-gray-400"),
                      { width: w.number }
                    ]}
                  >
                    {line.purchaseOrderLineType === "Comment" ? "" : rowIndex}
                  </Text>
                ) : null}
                {w.description ? (
                  <View style={[tw("pr-2"), { width: w.description }]}>
                    {isIndirect(line.purchaseOrderLineType) ? (
                      <Text style={{ ...tw("text-gray-900"), ...overflow }}>
                        {line.description ?? ""}
                      </Text>
                    ) : (
                      <>
                        <Text style={{ ...tw("text-gray-900"), ...overflow }}>
                          {getLineDescription(line)}
                        </Text>
                        <Text
                          style={{
                            ...tw("text-[7px] text-gray-600 mt-0.5"),
                            ...overflow
                          }}
                        >
                          {getLineDescriptionDetails(line)}
                        </Text>
                      </>
                    )}
                    {purchaseOrder.purchaseOrderType === "Outside Processing" &&
                    line.jobOperationDescription ? (
                      <Text style={tw("text-[7px] text-gray-600 mt-0.5")}>
                        {line.jobOperationDescription}
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
                    {(line.supplierShippingCost ?? 0) > 0 ? (
                      <Text style={tw("text-[7px] text-gray-600 mt-0.5")}>
                        {t("shipping")}{" "}
                        {numberFormatter.format(line.supplierShippingCost ?? 0)}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {w.qty ? (
                  <Text
                    style={[tw("text-center text-gray-600"), { width: w.qty }]}
                  >
                    {line.purchaseOrderLineType === "Comment"
                      ? ""
                      : line.purchaseQuantity}
                  </Text>
                ) : null}
                {w.uom ? (
                  <Text
                    style={[tw("text-center text-gray-600"), { width: w.uom }]}
                  >
                    {line.purchaseOrderLineType === "Comment"
                      ? ""
                      : line.purchaseUnitOfMeasureCode}
                  </Text>
                ) : null}
                {w.required ? (
                  <Text
                    style={[
                      tw("text-center text-gray-600"),
                      { width: w.required }
                    ]}
                  >
                    {line.purchaseOrderLineType === "Comment" ||
                    !line.requiredDate
                      ? ""
                      : formatDate(line.requiredDate, undefined, locale)}
                  </Text>
                ) : null}
                {w.unitPrice ? (
                  <Text
                    style={[
                      tw("text-center text-gray-600"),
                      { width: w.unitPrice }
                    ]}
                  >
                    {line.purchaseOrderLineType === "Comment"
                      ? ""
                      : rateFormatter.format(line.supplierUnitPrice ?? 0)}
                  </Text>
                ) : null}
                {w.netValue ? (
                  <Text
                    style={[
                      tw("text-center text-gray-600"),
                      { width: w.netValue }
                    ]}
                  >
                    {line.purchaseOrderLineType === "Comment"
                      ? ""
                      : numberFormatter.format(netValue)}
                  </Text>
                ) : null}
                {w.taxValue ? (
                  <View style={{ width: w.taxValue }}>
                    {line.purchaseOrderLineType !== "Comment" ? (
                      <View style={tw("flex flex-col items-center")}>
                        <Text style={tw("text-gray-600")}>
                          {numberFormatter.format(line.supplierTaxAmount ?? 0)}
                        </Text>
                        {taxPercentLabel ? (
                          <Text style={tw("text-[6px] text-gray-400")}>
                            {taxPercentLabel}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ) : null}
                {w.total ? (
                  <Text
                    style={[
                      tw("text-center text-gray-800 font-medium"),
                      { width: w.total }
                    ]}
                  >
                    {line.purchaseOrderLineType === "Comment"
                      ? ""
                      : numberFormatter.format(getLineTotal(line))}
                  </Text>
                ) : null}
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
