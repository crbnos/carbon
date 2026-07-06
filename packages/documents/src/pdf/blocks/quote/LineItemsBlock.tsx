import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { pluralize } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LINE_ITEMS_OPTIONS,
  type LineItemsBlock as LineItemsBlockType
} from "../../../template";
import {
  getLineDescription,
  getLineDescriptionDetails
} from "../../../utils/quote";
import { Note } from "../../components";
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
    colWidth,
    shouldConvertCurrency,
    exchangeRate,
    numberFormatter,
    thumbnails,
    theme,
    locale
  } = data;
  const opts = { ...DEFAULT_LINE_ITEMS_OPTIONS, ...block.options };
  const overflow = itemTextOverflowStyle(opts);
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
        <View style={tw("w-1/3")}>
          <Text>Description</Text>
        </View>
        <View style={tw("w-2/3 flex flex-row items-center")}>
          <Text style={tw(`${colWidth} text-center pr-3`)}>Qty</Text>
          <Text style={tw(`${colWidth} text-center pr-3`)}>Unit Price</Text>
          {!hasSinglePricePerLine && (
            <Text style={tw(`${colWidth} text-center pr-3`)}>Tax & Fees</Text>
          )}
          {hasAnyLeadTime && (
            <Text style={tw(`${colWidth} text-center pr-3`)}>Lead Time</Text>
          )}
          <Text style={tw(`${colWidth} text-center`)}>Total</Text>
        </View>
      </View>

      {quoteLines.map((line) => {
        const unitPriceNumberFormatter = new Intl.NumberFormat(locale, {
          style: "decimal",
          minimumFractionDigits: line.unitPricePrecision ?? 2,
          maximumFractionDigits: line.unitPricePrecision ?? 2
        });

        const additionalCharges = line.additionalCharges ?? {};

        return (
          <View key={line.id}>
            {line.status !== "No Quote" ? (
              <>
                {(line.quantity ?? []).map((quantity, index) => {
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
                      <View style={tw("w-1/3 pr-2")}>
                        {index === 0 && (
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
                              line.id in thumbnails && (
                                <View style={tw("mt-2")}>
                                  <Image
                                    src={thumbnails[line.id]!}
                                    style={{ width: 60, height: 60 }}
                                  />
                                </View>
                              )}
                            {totalTaxAndFees > 0 && (
                              <View style={tw("mt-1")}>
                                <Text
                                  style={tw(
                                    "text-[8px] text-gray-400 font-bold"
                                  )}
                                >
                                  Tax & Fees
                                </Text>
                                {(price?.convertedShippingCost ?? 0) > 0 && (
                                  <Text style={tw("text-[8px] text-gray-400")}>
                                    - Shipping
                                  </Text>
                                )}
                                {Object.values(additionalCharges)
                                  .filter(
                                    (charge) =>
                                      charge.description &&
                                      (charge.amounts?.[quantity] ?? 0) > 0
                                  )
                                  .sort((a, b) =>
                                    a.description.localeCompare(b.description)
                                  )
                                  .map((charge) => (
                                    <Text
                                      key={charge.description}
                                      style={tw("text-[8px] text-gray-400")}
                                    >
                                      - {charge.description}
                                    </Text>
                                  ))}
                                {taxPercent > 0 && (
                                  <Text style={tw("text-[8px] text-gray-400")}>
                                    - Tax ({(taxPercent * 100).toFixed(0)}%)
                                  </Text>
                                )}
                              </View>
                            )}
                          </>
                        )}
                      </View>
                      <View style={tw("w-2/3 flex flex-row")}>
                        <Text
                          style={tw(
                            `${colWidth} text-center text-gray-600 pr-3`
                          )}
                        >
                          {quantity} EA
                        </Text>
                        <Text
                          style={tw(
                            `${colWidth} text-center text-gray-600 pr-3`
                          )}
                        >
                          {unitPrice
                            ? unitPriceNumberFormatter.format(unitPrice)
                            : "-"}
                        </Text>
                        {!hasSinglePricePerLine && (
                          <Text
                            style={tw(
                              `${colWidth} text-center text-gray-600 pr-3`
                            )}
                          >
                            {totalTaxAndFees > 0
                              ? numberFormatter.format(totalTaxAndFees)
                              : "-"}
                          </Text>
                        )}
                        {hasAnyLeadTime && (
                          <Text
                            style={tw(
                              `${colWidth} text-center text-gray-600 pr-3`
                            )}
                          >
                            {leadTime > 0
                              ? `${leadTime} ${pluralize(leadTime, "day")}`
                              : "-"}
                          </Text>
                        )}
                        <Text
                          style={tw(
                            `${colWidth} text-center text-gray-800 font-medium`
                          )}
                        >
                          {hasSinglePricePerLine
                            ? netExtendedPrice > 0
                              ? numberFormatter.format(netExtendedPrice)
                              : "-"
                            : totalPrice > 0
                              ? numberFormatter.format(totalPrice)
                              : "-"}
                        </Text>
                      </View>
                    </View>
                  );
                })}
                {Object.keys(line.externalNotes ?? {}).length > 0 && (
                  <View style={tw("px-3 py-2 border-b border-gray-200")}>
                    <Note
                      key={`${line.id}-notes`}
                      content={line.externalNotes as JSONContent}
                    />
                  </View>
                )}
              </>
            ) : (
              <View
                wrap={false}
                style={[
                  tw(
                    "flex flex-row py-2 px-3 border-b border-gray-200 text-[10px]"
                  ),
                  {
                    backgroundColor:
                      rowIndex++ % 2 !== 0 && opts.zebra
                        ? "rgba(249, 250, 251, 0.6)"
                        : "transparent"
                  }
                ]}
              >
                <View style={tw("w-1/3 pr-2")}>
                  <Text style={tw("text-gray-800")}>
                    {getLineDescription(line)}
                  </Text>
                  <Text style={tw("text-[8px] text-gray-400 mt-0.5")}>
                    {getLineDescriptionDetails(line)}
                  </Text>
                </View>
                <View style={tw("w-2/3 flex flex-row")}>
                  <Text
                    style={tw(`${colWidth} text-right text-gray-600 font-bold`)}
                  >
                    No Quote
                  </Text>
                  <View style={tw("flex-1 text-right")}>
                    <Text style={tw("text-gray-400 text-[8px] text-right")}>
                      {line.noQuoteReason ?? ""}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
