// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { distinctItemText } from "@carbon/utils";
import { Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType,
  makeText,
  salesReturnOrderTexts
} from "../../../template";
import { columnWidths } from "../columns";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { SalesReturnOrderData } from "./types";

export function LineItemsBlock({
  block,
  data
}: {
  block: LineItemsBlockType;
  data: SalesReturnOrderData;
}) {
  const tw = useTw();
  const {
    salesReturnOrderLines,
    numberFormatter,
    rateFormatter,
    currencyCode,
    theme
  } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);
  const t = makeText(salesReturnOrderTexts.lineItems, block, data.vars);
  const w = columnWidths(
    [
      { key: "number", width: 6 },
      { key: "item", width: 40 },
      { key: "qtyAuthorized", width: 16 },
      { key: "unitPrice", width: 18 },
      { key: "reason", width: 20 }
    ],
    t.shows,
    "item"
  );

  const total = salesReturnOrderLines.reduce(
    (sum, line) => sum + (line.quantity ?? 0) * (line.unitPrice ?? 0),
    0
  );

  return (
    <View style={tw("mb-4")}>
      {/* Header */}
      <View
        fixed
        style={[
          tw("flex flex-row py-2 px-3 text-[9px] font-bold items-center"),
          { backgroundColor: theme.accent, color: theme.accentForeground }
        ]}
      >
        {w.number ? (
          <Text style={[tw("text-center"), { width: w.number }]}>
            {t("number")}
          </Text>
        ) : null}
        {w.item ? <Text style={{ width: w.item }}>{t("item")}</Text> : null}
        {w.qtyAuthorized ? (
          <Text style={[tw("text-center"), { width: w.qtyAuthorized }]}>
            {t("qtyAuthorized")}
          </Text>
        ) : null}
        {w.unitPrice ? (
          <Text style={[tw("text-center"), { width: w.unitPrice }]}>
            {t("unitPrice")}
          </Text>
        ) : null}
        {w.reason ? (
          <Text style={[tw("text-center"), { width: w.reason }]}>
            {t("reason")}
          </Text>
        ) : null}
      </View>

      {salesReturnOrderLines.map((line, index) => (
        <View
          key={line.id}
          wrap={false}
          style={[
            tw("flex flex-row py-2 px-3 border-b border-gray-200 text-[10px]"),
            {
              backgroundColor:
                opts.zebra && index % 2 === 1
                  ? "rgba(249, 250, 251, 0.6)"
                  : "transparent"
            }
          ]}
        >
          {w.number ? (
            <Text
              style={[tw("text-center text-gray-600"), { width: w.number }]}
            >
              {line.lineNumber}
            </Text>
          ) : null}
          {w.item ? (
            <View style={[tw("pr-2"), { width: w.item }]}>
              <Text style={{ ...tw("text-gray-800"), ...overflow }}>
                {line.item?.readableIdWithRevision ?? ""}
              </Text>
              {distinctItemText(
                line.item?.readableIdWithRevision,
                line.item?.name
              ) ? (
                <Text
                  style={{
                    ...tw("text-[9px] text-gray-600 mt-0.5"),
                    ...overflow
                  }}
                >
                  {line.item?.name}
                </Text>
              ) : null}
            </View>
          ) : null}
          {w.qtyAuthorized ? (
            <Text
              style={[
                tw("text-center text-gray-600"),
                { width: w.qtyAuthorized }
              ]}
            >
              {`${line.quantity ?? 0} ${line.unitOfMeasureCode ?? "EA"}`}
            </Text>
          ) : null}
          {w.unitPrice ? (
            <Text
              style={[tw("text-center text-gray-600"), { width: w.unitPrice }]}
            >
              {rateFormatter.format(line.unitPrice ?? 0)}
            </Text>
          ) : null}
          {w.reason ? (
            <Text
              style={[tw("text-center text-gray-600"), { width: w.reason }]}
            >
              {line.returnReason?.name ?? ""}
            </Text>
          ) : null}
        </View>
      ))}

      {total > 0 ? (
        <View style={tw("flex flex-row py-2 px-3 text-[9px]")}>
          {/* The label fills what the amount and reason columns leave. */}
          <Text style={tw("flex-1 text-right pr-3 text-gray-800 font-bold")}>
            {currencyCode ? `${t("total")} (${currencyCode})` : t("total")}
          </Text>
          <Text
            style={[
              tw("text-center text-gray-800 font-bold"),
              { width: w.unitPrice ?? "18%" }
            ]}
          >
            {numberFormatter.format(total)}
          </Text>
          {w.reason ? <Text style={{ width: w.reason }} /> : null}
        </View>
      ) : null}
    </View>
  );
}
