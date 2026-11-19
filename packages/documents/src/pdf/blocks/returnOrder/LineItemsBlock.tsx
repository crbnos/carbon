// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Text, View } from "@react-pdf/renderer";
import type { DocumentTheme, DocumentValues } from "../../../template";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType,
  makeText,
  type purchaseReturnOrderTexts,
  type salesReturnOrderTexts
} from "../../../template";
import { Cell, TextCell } from "../Cell";
import { columnWidths } from "../columns";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import { buildReturnOrderLineVars, type ReturnOrderLine } from "./vars";

type ReturnOrderLineTexts =
  | typeof salesReturnOrderTexts.lineItems
  | typeof purchaseReturnOrderTexts.lineItems;

/** The line table of a return order, to a supplier or from a customer. */
export function ReturnOrderLineItems({
  block,
  texts,
  lines,
  data
}: {
  block: LineItemsBlockType;
  texts: ReturnOrderLineTexts;
  lines: ReturnOrderLine[];
  data: {
    theme: DocumentTheme;
    vars: Record<string, string>;
    values: DocumentValues;
    rateFormatter: Intl.NumberFormat;
  };
}) {
  const tw = useTw();
  const { theme } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);
  const t = makeText(texts, block, data.vars);
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

  return (
    <View style={tw("mb-4")}>
      <View
        fixed
        style={[
          tw("flex flex-row py-2 px-3 text-[9px] font-bold items-center"),
          { backgroundColor: theme.accent, color: theme.accentForeground }
        ]}
      >
        <TextCell width={w.number} style={tw("text-center")}>
          {t("number")}
        </TextCell>
        <TextCell width={w.item}>{t("item")}</TextCell>
        <TextCell width={w.qtyAuthorized} style={tw("text-center")}>
          {t("qtyAuthorized")}
        </TextCell>
        <TextCell width={w.unitPrice} style={tw("text-center")}>
          {t("unitPrice")}
        </TextCell>
        <TextCell width={w.reason} style={tw("text-center")}>
          {t("reason")}
        </TextCell>
      </View>

      {lines.map((line, index) => {
        const row = data.values.row(
          "line",
          line.id,
          buildReturnOrderLineVars(line, data.rateFormatter)
        );
        return (
          <View
            key={line.id}
            wrap={false}
            style={[
              tw(
                "flex flex-row py-2 px-3 border-b border-gray-200 text-[10px]"
              ),
              {
                backgroundColor:
                  opts.zebra && index % 2 === 1
                    ? "rgba(249, 250, 251, 0.6)"
                    : "transparent"
              }
            ]}
          >
            <TextCell width={w.number} style={tw("text-center text-gray-600")}>
              {t("numberCell", row)}
            </TextCell>
            <Cell width={w.item} style={tw("pr-2")}>
              <Text style={{ ...tw("text-gray-800"), ...overflow }}>
                {t("itemCell", row)}
              </Text>
              {t.prints("itemNameCell", row) ? (
                <Text
                  style={{
                    ...tw("text-[9px] text-gray-600 mt-0.5"),
                    ...overflow
                  }}
                >
                  {t("itemNameCell", row)}
                </Text>
              ) : null}
            </Cell>
            <TextCell
              width={w.qtyAuthorized}
              style={tw("text-center text-gray-600")}
            >
              {t("qtyAuthorizedCell", row)}
            </TextCell>
            <TextCell
              width={w.unitPrice}
              style={tw("text-center text-gray-600")}
            >
              {t("unitPriceCell", row)}
            </TextCell>
            <TextCell width={w.reason} style={tw("text-center text-gray-600")}>
              {t("reasonCell", row)}
            </TextCell>
          </View>
        );
      })}

      {t.prints("totalValue") ? (
        <View style={tw("flex flex-row py-2 px-3 text-[9px]")}>
          {/* The label fills what the amount and reason columns leave. */}
          <Text style={tw("flex-1 text-right pr-3 text-gray-800 font-bold")}>
            {t("total")}
          </Text>
          <Text
            style={[
              tw("text-center text-gray-800 font-bold"),
              { width: w.unitPrice ?? "18%" }
            ]}
          >
            {t("totalValue")}
          </Text>
          <TextCell width={w.reason} />
        </View>
      ) : null}
    </View>
  );
}
