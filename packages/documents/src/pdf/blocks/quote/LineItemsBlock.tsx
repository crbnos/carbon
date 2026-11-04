// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import {
  DEFAULT_CURRENCY_DECIMALS,
  formatPercent,
  moneyFormatOptions,
  pluralize
} from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType,
  makeText,
  quoteTexts
} from "../../../template";
import {
  getLineDescription,
  getLineDescriptionDetails
} from "../../../utils/quote";
import { Note } from "../../components";
import { columnWidths } from "../columns";
import { itemTextOverflowStyle } from "../itemText";
import { useTw } from "../tw";
import type { QuoteData } from "./types";

type QuoteLinePrice = Database["public"]["Tables"]["quoteLinePrice"]["Row"];

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
    pricesByLine,
    hasSinglePricePerLine,
    hasAnyLeadTime,
    shouldConvertCurrency,
    exchangeRate,
    numberFormatter,
    thumbnails,
    theme,
    locale
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

  // Unlike its sales-order/purchase-order siblings, a quote carries a PER-LINE
  // unit-price precision (`quoteLine.unitPricePrecision`, constrained to 2/3/4),
  // so it cannot reuse the single hoisted `numberFormatter`. Index the few
  // distinct precisions once instead of constructing a formatter per line.
  const unitPriceFormatters = new Map<number, Intl.NumberFormat>();
  const unitPriceFormatter = (precision: number | null | undefined) => {
    const digits = precision ?? DEFAULT_CURRENCY_DECIMALS;
    let formatter = unitPriceFormatters.get(digits);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, moneyFormatOptions(digits));
      unitPriceFormatters.set(digits, formatter);
    }
    return formatter;
  };

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
          <View style={{ width: w.description }}>
            <Text>{t("description")}</Text>
          </View>
        ) : null}
        {w.qty ? (
          <Text style={[tw("text-center pr-3"), { width: w.qty }]}>
            {t("qty")}
          </Text>
        ) : null}
        {w.unitPrice ? (
          <Text style={[tw("text-center pr-3"), { width: w.unitPrice }]}>
            {t("unitPrice")}
          </Text>
        ) : null}
        {w.columnTaxAndFees ? (
          <Text style={[tw("text-center pr-3"), { width: w.columnTaxAndFees }]}>
            {t("columnTaxAndFees")}
          </Text>
        ) : null}
        {w.leadTime ? (
          <Text style={[tw("text-center pr-3"), { width: w.leadTime }]}>
            {t("leadTime")}
          </Text>
        ) : null}
        {w.total ? (
          <Text style={[tw("text-center"), { width: w.total }]}>
            {t("total")}
          </Text>
        ) : null}
      </View>

      {quoteLines.map((line) => {
        const unitPriceNumberFormatter = unitPriceFormatter(
          line.unitPricePrecision
        );

        const additionalCharges = line.additionalCharges ?? {};

        return (
          <View key={line.id}>
            <>
              {[...(line.quantity ?? [])]
                .sort((a, b) => a - b)
                .map((quantity, index) => {
                  const prices =
                    line.id != null ? (pricesByLine[line.id] ?? []) : [];
                  const price = prices.find(
                    (p: QuoteLinePrice) => p.quantity === quantity
                  );
                  const unitPrice = price?.convertedUnitPrice ?? 0;
                  const netExtendedPrice =
                    price?.convertedNetExtendedPrice ?? 0;
                  const isEven = rowIndex % 2 === 0;
                  rowIndex++;

                  const leadTime = price?.leadTime ?? 0;

                  const additionalCharge = Object.values(
                    additionalCharges
                  ).reduce((acc, charge) => {
                    let amount = charge.amounts?.[quantity] ?? 0;
                    if (shouldConvertCurrency) amount *= exchangeRate;
                    return acc + amount;
                  }, 0);
                  const taxableAdditionalCharge = Object.values(
                    additionalCharges
                  ).reduce((acc, charge) => {
                    if (charge.taxable === false) return acc;
                    let amount = charge.amounts?.[quantity] ?? 0;
                    if (shouldConvertCurrency) amount *= exchangeRate;
                    return acc + amount;
                  }, 0);
                  const shippingCost = price?.convertedShippingCost ?? 0;
                  const taxPercent = line.taxPercent ?? 0;
                  const taxableBeforeTax =
                    netExtendedPrice + taxableAdditionalCharge + shippingCost;
                  const taxAmount = taxableBeforeTax * taxPercent;
                  const totalTaxAndFees =
                    additionalCharge + shippingCost + taxAmount;
                  const totalPrice = netExtendedPrice + totalTaxAndFees;

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
                      {w.description ? (
                        <View style={[tw("pr-2"), { width: w.description }]}>
                          {index === 0 ? (
                            <>
                              <Text
                                style={{ ...tw("text-gray-800"), ...overflow }}
                              >
                                {getLineDescription(line)}
                              </Text>
                              <Text
                                style={{
                                  ...tw("text-[8px] text-gray-400 mt-0.5"),
                                  ...overflow
                                }}
                              >
                                {getLineDescriptionDetails(line)}
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
                                  {(price?.convertedShippingCost ?? 0) > 0 ? (
                                    <View
                                      style={tw(
                                        "flex flex-row justify-between"
                                      )}
                                    >
                                      <Text
                                        style={tw(
                                          "text-[8px] text-gray-400 flex-1 pr-2"
                                        )}
                                      >
                                        {t("shipping")}
                                      </Text>
                                      <Text
                                        style={tw("text-[8px] text-gray-400")}
                                      >
                                        {numberFormatter.format(
                                          price?.convertedShippingCost ?? 0
                                        )}
                                      </Text>
                                    </View>
                                  ) : null}
                                  {Object.values(additionalCharges)
                                    .filter(
                                      (charge) =>
                                        charge.description &&
                                        (charge.amounts?.[quantity] ?? 0) > 0
                                    )
                                    .sort((a, b) =>
                                      a.description.localeCompare(b.description)
                                    )
                                    .map((charge) => {
                                      let chargeAmount =
                                        charge.amounts?.[quantity] ?? 0;
                                      if (shouldConvertCurrency)
                                        chargeAmount *= exchangeRate;
                                      return (
                                        <View
                                          key={charge.description}
                                          style={tw(
                                            "flex flex-row justify-between"
                                          )}
                                        >
                                          <Text
                                            style={tw(
                                              "text-[8px] text-gray-400 flex-1 pr-2"
                                            )}
                                          >
                                            - {charge.description}
                                          </Text>
                                          <Text
                                            style={tw(
                                              "text-[8px] text-gray-400"
                                            )}
                                          >
                                            {numberFormatter.format(
                                              chargeAmount
                                            )}
                                          </Text>
                                        </View>
                                      );
                                    })}
                                  {taxPercent > 0 ? (
                                    <View
                                      style={tw(
                                        "flex flex-row justify-between"
                                      )}
                                    >
                                      <Text
                                        style={tw(
                                          "text-[8px] text-gray-400 flex-1 pr-2"
                                        )}
                                      >
                                        {t("tax")} (
                                        {formatPercent(taxPercent, locale)})
                                      </Text>
                                      <Text
                                        style={tw("text-[8px] text-gray-400")}
                                      >
                                        {numberFormatter.format(taxAmount)}
                                      </Text>
                                    </View>
                                  ) : null}
                                </View>
                              ) : null}
                            </>
                          ) : null}
                        </View>
                      ) : null}
                      {w.qty ? (
                        <Text
                          style={[
                            tw("text-center text-gray-600 pr-3"),
                            { width: w.qty }
                          ]}
                        >
                          {quantity} EA
                        </Text>
                      ) : null}
                      {w.unitPrice ? (
                        <Text
                          style={[
                            tw("text-center text-gray-600 pr-3"),
                            { width: w.unitPrice }
                          ]}
                        >
                          {unitPrice
                            ? unitPriceNumberFormatter.format(unitPrice)
                            : "-"}
                        </Text>
                      ) : null}
                      {w.columnTaxAndFees ? (
                        <Text
                          style={[
                            tw("text-center text-gray-600 pr-3"),
                            { width: w.columnTaxAndFees }
                          ]}
                        >
                          {totalTaxAndFees > 0
                            ? numberFormatter.format(totalTaxAndFees)
                            : "-"}
                        </Text>
                      ) : null}
                      {w.leadTime ? (
                        <Text
                          style={[
                            tw("text-center text-gray-600 pr-3"),
                            { width: w.leadTime }
                          ]}
                        >
                          {leadTime > 0
                            ? `${leadTime} ${pluralize(leadTime, "day")}`
                            : "-"}
                        </Text>
                      ) : null}
                      {w.total ? (
                        <Text
                          style={[
                            tw("text-center text-gray-800 font-medium"),
                            { width: w.total }
                          ]}
                        >
                          {hasSinglePricePerLine
                            ? netExtendedPrice > 0
                              ? numberFormatter.format(netExtendedPrice)
                              : "-"
                            : totalPrice > 0
                              ? numberFormatter.format(totalPrice)
                              : "-"}
                        </Text>
                      ) : null}
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
