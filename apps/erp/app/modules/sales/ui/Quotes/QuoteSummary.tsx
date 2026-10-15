// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  RadioGroup,
  RadioGroupItem,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  TruncatedTooltipText,
  useViewport,
  VStack
} from "@carbon/react";
import { distinctItemText } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuChevronRight, LuImage } from "react-icons/lu";
import { Link, useParams } from "react-router";
import {
  CustomerAvatar,
  DateTime,
  MotionMoney,
  RevisionSuffix
} from "~/components";
import { SummaryLineList, SummaryLineRow } from "~/components/SummaryLineRow";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePercentFormatter,
  useRouteData,
  useUser
} from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";
import { isQuoteLocked } from "../../sales.models";
import type {
  Quotation,
  QuotationLine,
  QuotationPrice,
  QuotationShipment,
  SalesOrderLine
} from "../../types";
import {
  deselectedLine,
  type SelectedLine,
  selectQuoteLines
} from "./quote-summary-selection";

const LineItems = ({
  currencyCode,
  formatter,
  locale,
  selectedLines,
  onSelectQuantity
}: {
  currencyCode: string;
  formatter: Intl.NumberFormat;
  locale: string;
  selectedLines: Record<string, SelectedLine>;
  onSelectQuantity: (lineId: string, quantity: number) => void;
}) => {
  // Settlement money at the document currency's configured decimals.
  const currencyDecimals = useCurrencyDecimals(currencyCode);
  const { company } = useUser();
  const { isPhone } = useViewport();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quote id");
  const routeData = useRouteData<{
    quote: Quotation;
    lines: QuotationLine[];
    prices: QuotationPrice[];
  }>(path.to.quote(quoteId));

  const [openItems, setOpenItems] = useState<string[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    Object.entries(selectedLines).forEach(([lineId, line]) => {
      if (line.quantity === 0 && openItems.includes(lineId)) {
        setOpenItems((prev) => prev.filter((item) => item !== lineId));
      }
    });
  }, [selectedLines]);

  const pricingByLine = useMemo(
    () =>
      routeData?.lines?.reduce<Record<string, QuotationPrice[]>>(
        (acc, line) => {
          if (!line.id) {
            return acc;
          }
          // Scope to the breaks the line still offers — a removed break can
          // leave an orphaned price row behind.
          acc[line.id!] =
            routeData?.prices
              ?.filter(
                (p) =>
                  p.quoteLineId === line.id &&
                  Array.isArray(line.quantity) &&
                  line.quantity.includes(p.quantity)
              )
              .sort((a, b) => a.quantity - b.quantity) ?? [];
          return acc;
        },
        {}
      ) ?? {},
    [routeData?.lines, routeData?.prices]
  );

  const toggleOpen = (id: string) => {
    setOpenItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const shouldConvertCurrency =
    routeData?.quote.currencyCode !== company?.baseCurrencyCode;

  const rows = routeData?.lines?.map((line) => {
    const prices = pricingByLine[line.id!];

    if (!line || !prices || !line.id) {
      return null;
    }

    const selectedLine = selectedLines[line.id] || deselectedLine;
    const lineTotal =
      (selectedLine.convertedNetUnitPrice ?? 0) * (selectedLine.quantity ?? 0) +
      (selectedLine.convertedAddOn ?? 0) +
      (selectedLine.convertedShippingCost ?? 0) +
      ((selectedLine.convertedNetUnitPrice ?? 0) *
        (selectedLine.quantity ?? 0) +
        (selectedLine.convertedTaxableAddOn ?? 0) +
        (selectedLine.convertedShippingCost ?? 0)) *
        (selectedLine.taxPercent ?? 0);
    // The quantity-break picker: a tap on the line opens it.
    const pricingOptions = (
      <motion.div
        initial="collapsed"
        animate={openItems.includes(line.id) ? "open" : "collapsed"}
        variants={{
          open: { opacity: 1, height: "auto", marginTop: 16 },
          collapsed: { opacity: 0, height: 0, marginTop: 0 }
        }}
        transition={{ duration: 0.3 }}
        className="w-full overflow-hidden"
      >
        <LinePricingOptions
          formatter={formatter}
          line={line}
          options={pricingByLine[line.id!]}
          quoteCurrency={routeData?.quote.currencyCode ?? "USD"}
          quoteExchangeRate={routeData?.quote.exchangeRate ?? 1}
          shouldConvertCurrency={shouldConvertCurrency}
          locale={locale}
          selectedLine={selectedLine}
          onSelectQuantity={onSelectQuantity}
        />
      </motion.div>
    );

    // Phones: a text row (no image or Edit link); the line page opens
    // from the Lines tab.
    if (isPhone) {
      return (
        <div key={line.id} className="w-full">
          <SummaryLineRow
            expanded={openItems.includes(line.id)}
            onClick={() => toggleOpen(line.id!)}
            title={line.itemReadableId}
            value={
              <MotionMoney
                value={lineTotal}
                currency={currencyCode}
                decimalPlaces={currencyDecimals}
              />
            }
            trailing={
              <motion.span
                className="self-center text-muted-foreground"
                animate={{ rotate: openItems.includes(line.id) ? 90 : 0 }}
                transition={{ duration: 0.3 }}
              >
                <LuChevronRight className="size-4" />
              </motion.span>
            }
            description={distinctItemText(
              line.itemReadableId,
              line.description
            )}
            meta={
              selectedLine.quantity > 0 ? (
                <>
                  {selectedLine.quantity} ×{" "}
                  {formatter.format(selectedLine.convertedNetUnitPrice ?? 0)}{" "}
                  {line.unitOfMeasureCode}
                </>
              ) : null
            }
          />
          {pricingOptions}
        </div>
      );
    }

    return (
      <motion.div
        key={line.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="border-b border-input py-6 w-full"
      >
        <HStack spacing={4} className="items-start">
          {line.thumbnailPath ? (
            <img
              alt={line.itemReadableId!}
              className="w-24 h-24 shrink-0 bg-gradient-to-bl from-muted to-muted/40 rounded-lg"
              src={getPrivateUrl(line.thumbnailPath)}
            />
          ) : (
            <div className="w-24 h-24 shrink-0 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-4">
              <LuImage className="w-16 h-16 text-muted-foreground" />
            </div>
          )}

          <VStack spacing={0} className="flex-1 min-w-0">
            <div
              className="flex flex-col cursor-pointer w-full"
              onClick={() => toggleOpen(line.id!)}
            >
              <div className="flex items-center gap-x-4 justify-between flex-grow">
                <HStack spacing={2} className="min-w-0 flex-shrink">
                  <Heading className="truncate">{line.itemReadableId}</Heading>
                  <Button
                    asChild
                    variant="link"
                    size="sm"
                    className="text-muted-foreground flex-shrink-0"
                  >
                    <Link to={path.to.quoteLine(quoteId, line.id!)}>Edit</Link>
                  </Button>
                </HStack>
                <HStack spacing={4}>
                  <MotionMoney
                    className="font-semibold text-xl whitespace-nowrap"
                    value={lineTotal}
                    currency={currencyCode}
                    decimalPlaces={currencyDecimals}
                  />
                  <motion.div
                    animate={{
                      rotate: openItems.includes(line.id) ? 90 : 0
                    }}
                    transition={{ duration: 0.3 }}
                  >
                    <LuChevronRight size={24} />
                  </motion.div>
                </HStack>
              </div>
              {distinctItemText(line.itemReadableId, line.description) && (
                <TruncatedTooltipText
                  className="text-muted-foreground text-sm truncate"
                  tooltip={line.description}
                >
                  {line.description}
                </TruncatedTooltipText>
              )}
            </div>
          </VStack>
        </HStack>

        {pricingOptions}
      </motion.div>
    );
  });

  if (isPhone) {
    return <SummaryLineList className="tracking-tight">{rows}</SummaryLineList>;
  }

  return (
    <VStack spacing={8} className="w-full overflow-hidden tracking-tight">
      {rows}
    </VStack>
  );
};

type LinePricingOptionsProps = {
  line: QuotationLine;
  options: QuotationPrice[];
  quoteCurrency: string;
  shouldConvertCurrency: boolean;
  quoteExchangeRate: number;
  locale: string;
  formatter: Intl.NumberFormat;
  selectedLine: SelectedLine;
  onSelectQuantity: (lineId: string, quantity: number) => void;
};

const LinePricingOptions = ({
  line,
  options,
  quoteCurrency,
  shouldConvertCurrency,
  quoteExchangeRate,
  locale,
  formatter,
  selectedLine,
  onSelectQuantity
}: LinePricingOptionsProps) => {
  // Settlement money at the document currency's configured decimals.
  const currencyDecimals = useCurrencyDecimals(quoteCurrency);
  const percentFormatter = usePercentFormatter();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quote id");
  const routeData = useRouteData<{
    quote: Quotation;
    salesOrderLines: SalesOrderLine[];
  }>(path.to.quote(quoteId));

  const selectedValue = selectedLine.quantity.toString();

  const additionalChargesByQuantity =
    line.quantity?.reduce(
      (acc, quantity) => {
        const charges = Object.values(line.additionalCharges ?? {}).reduce(
          (chargeAcc, charge) => {
            const amount = charge.amounts?.[quantity];
            return chargeAcc + amount;
          },
          0
        );
        acc[quantity] = charges;
        return acc;
      },
      { 0: 0 } as Record<number, number>
    ) ?? {};

  const convertedAdditionalChargesByQuantity = Object.entries(
    additionalChargesByQuantity
  ).reduce<Record<number, number>>(
    (acc, [quantity, amount]) => {
      acc[Number(quantity)] = amount * quoteExchangeRate;
      return acc;
    },
    { 0: 0 }
  );

  const additionalCharges: { name: string; amount: number }[] = [];
  if (selectedLine.convertedShippingCost) {
    additionalCharges.push({
      name: "Shipping",
      amount: selectedLine.convertedShippingCost
    });
  }
  Object.entries(line.additionalCharges ?? {}).forEach(([name, charge]) => {
    additionalCharges.push({
      name: charge.description,
      amount: charge.amounts?.[selectedLine.quantity] * quoteExchangeRate
    });
  });

  const hasAnyShipping = options.some(
    (option) => (option.convertedShippingCost ?? 0) > 0
  );
  const hasAnyFees = options.some(
    (option) => (convertedAdditionalChargesByQuantity[option.quantity] ?? 0) > 0
  );

  return (
    <VStack spacing={4}>
      <RadioGroup
        className="w-full"
        value={selectedValue}
        disabled={["Ordered", "Partial", "Expired", "Cancelled"].includes(
          routeData?.quote.status ?? ""
        )}
        onValueChange={(value) => {
          if (
            value === "0" ||
            options.some((opt) => opt.quantity.toString() === value)
          ) {
            onSelectQuantity(line.id!, Number(value));
          }
        }}
      >
        <Table>
          <Thead>
            <Tr>
              <Th />
              <Th>
                <Trans>Quantity</Trans>
              </Th>
              <Th>
                <Trans>Unit Price</Trans>
              </Th>
              <Th>
                <Trans>Discount</Trans>
              </Th>
              {hasAnyShipping && (
                <Th>
                  <Trans>Shipping</Trans>
                </Th>
              )}
              {hasAnyFees && (
                <Th>
                  <Trans>Fees</Trans>
                </Th>
              )}
              <Th>
                <Trans>Lead Time</Trans>
              </Th>
              <Th>
                <Trans>Subtotal</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {!Array.isArray(options) || options.length === 0 ? (
              <Tr>
                <Td
                  colSpan={5 + (hasAnyShipping ? 1 : 0) + (hasAnyFees ? 1 : 0)}
                  className="text-center py-8"
                >
                  No pricing options found
                </Td>
              </Tr>
            ) : (
              options.map(
                (option, index) =>
                  (line?.quantity?.includes(option.quantity) ||
                    option.quantity === 0) && (
                    <Tr key={index}>
                      <Td>
                        <RadioGroupItem
                          value={option.quantity.toString()}
                          id={`${line.id}:${option.quantity.toString()}`}
                        />
                        <label
                          htmlFor={`${line.id}:${option.quantity.toString()}`}
                          className="sr-only"
                        >
                          {option.quantity}
                        </label>
                      </Td>
                      <Td>{option.quantity}</Td>
                      <Td>
                        {formatter.format(option.convertedUnitPrice ?? 0)}
                      </Td>
                      <Td>
                        {option.discountPercent > 0
                          ? percentFormatter.format(option.discountPercent)
                          : "-"}
                      </Td>
                      {hasAnyShipping && (
                        <Td>
                          {(option.convertedShippingCost ?? 0) > 0
                            ? formatter.format(
                                option.convertedShippingCost ?? 0
                              )
                            : "-"}
                        </Td>
                      )}
                      {hasAnyFees && (
                        <Td>
                          {(convertedAdditionalChargesByQuantity[
                            option.quantity
                          ] ?? 0) > 0
                            ? formatter.format(
                                convertedAdditionalChargesByQuantity[
                                  option.quantity
                                ]
                              )
                            : "-"}
                        </Td>
                      )}
                      <Td>
                        {new Intl.NumberFormat(locale, {
                          style: "unit",
                          unit: "day"
                        }).format(option.leadTime)}
                      </Td>
                      <Td>
                        {formatter.format(
                          (option.convertedNetUnitPrice ?? 0) *
                            option.quantity +
                            convertedAdditionalChargesByQuantity[
                              option.quantity
                            ] +
                            (option.convertedShippingCost ?? 0)
                        )}
                      </Td>
                    </Tr>
                  )
              )
            )}
          </Tbody>
        </Table>
      </RadioGroup>

      {selectedLine.quantity !== 0 && (
        <div className="w-full">
          <Table>
            <Tbody>
              <Tr key="extended-price" className="border-b border-border">
                <Td>
                  <Trans>Extended Price</Trans>
                </Td>
                <Td className="text-right">
                  <MotionMoney
                    value={
                      (selectedLine.convertedUnitPrice ?? 0) *
                      selectedLine.quantity
                    }
                    currency={quoteCurrency}
                    decimalPlaces={currencyDecimals}
                  />
                </Td>
              </Tr>

              {selectedLine.discountPercent > 0 && (
                <Tr key="discount" className="border-b border-border">
                  <Td>
                    Discount (
                    {percentFormatter.format(selectedLine.discountPercent)})
                  </Td>
                  <Td className="text-right">
                    -
                    <MotionMoney
                      value={
                        (selectedLine.convertedUnitPrice ?? 0) *
                        selectedLine.quantity *
                        selectedLine.discountPercent
                      }
                      currency={quoteCurrency}
                      decimalPlaces={currencyDecimals}
                    />
                  </Td>
                </Tr>
              )}

              {additionalCharges.length > 0 &&
                additionalCharges.map((charge) => (
                  <Tr
                    key={charge.name}
                    className={
                      additionalCharges[additionalCharges.length - 1] === charge
                        ? "border-b border-border"
                        : ""
                    }
                  >
                    <Td>{charge.name}</Td>
                    <Td className="text-right">
                      <MotionMoney
                        value={charge.amount}
                        currency={quoteCurrency}
                        decimalPlaces={currencyDecimals}
                      />
                    </Td>
                  </Tr>
                ))}

              <Tr key="subtotal">
                <Td>
                  <Trans>Subtotal</Trans>
                </Td>
                <Td className="text-right">
                  <MotionMoney
                    value={
                      (selectedLine.convertedNetUnitPrice ?? 0) *
                        selectedLine.quantity +
                      (selectedLine.convertedAddOn ?? 0) +
                      (selectedLine.convertedShippingCost ?? 0)
                    }
                    currency={quoteCurrency}
                    decimalPlaces={currencyDecimals}
                  />
                </Td>
              </Tr>

              <Tr key="tax" className="border-b border-border">
                <Td>
                  Tax ({percentFormatter.format(selectedLine.taxPercent)})
                </Td>
                <Td className="text-right">
                  <MotionMoney
                    value={
                      ((selectedLine.convertedNetUnitPrice ?? 0) *
                        selectedLine.quantity +
                        (selectedLine.convertedTaxableAddOn ?? 0) +
                        (selectedLine.convertedShippingCost ?? 0)) *
                      (selectedLine.taxPercent ?? 0)
                    }
                    currency={quoteCurrency}
                    decimalPlaces={currencyDecimals}
                  />
                </Td>
              </Tr>

              <Tr key="total" className="font-semibold">
                <Td>
                  <Trans>Total</Trans>
                </Td>
                <Td className="text-right">
                  <MotionMoney
                    value={
                      (selectedLine.convertedNetUnitPrice ?? 0) *
                        selectedLine.quantity +
                      (selectedLine.convertedAddOn ?? 0) +
                      (selectedLine.convertedShippingCost ?? 0) +
                      ((selectedLine.convertedNetUnitPrice ?? 0) *
                        selectedLine.quantity +
                        (selectedLine.convertedTaxableAddOn ?? 0) +
                        (selectedLine.convertedShippingCost ?? 0)) *
                        (selectedLine.taxPercent ?? 0)
                    }
                    currency={quoteCurrency}
                    decimalPlaces={currencyDecimals}
                  />
                </Td>
              </Tr>
            </Tbody>
          </Table>
        </div>
      )}
    </VStack>
  );
};

const QuoteSummary = ({
  onEditShippingCost
}: {
  onEditShippingCost: () => void;
}) => {
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quote id");
  const routeData = useRouteData<{
    quote: Quotation;
    lines: QuotationLine[];
    prices: QuotationPrice[];
    shipment: QuotationShipment;
    salesOrderLines: SalesOrderLine[];
  }>(path.to.quote(quoteId));

  const isEditable = !isQuoteLocked(routeData?.quote?.status);

  const { locale } = useLocale();
  const formatter = useCurrencyFormatter({
    currency: routeData?.quote.currencyCode ?? "USD"
  });
  // Settlement money at the document currency's configured decimals.
  const currencyDecimals = useCurrencyDecimals(
    routeData?.quote?.currencyCode ?? "USD"
  );

  // Only what the user picked; everything else follows the quote's data.
  const [picks, setPicks] = useState<Record<string, number>>({});
  const selectedLines = useMemo(
    () =>
      selectQuoteLines({
        lines: routeData?.lines,
        prices: routeData?.prices,
        salesOrderLines: routeData?.salesOrderLines,
        exchangeRate: routeData?.quote.exchangeRate ?? 1,
        picks
      }),
    [
      routeData?.lines,
      routeData?.prices,
      routeData?.salesOrderLines,
      routeData?.quote.exchangeRate,
      picks
    ]
  );
  const onSelectQuantity = useCallback(
    (lineId: string, quantity: number) =>
      setPicks((prev) => ({ ...prev, [lineId]: quantity })),
    []
  );

  // The selection is seeded once, so a line deleted since then still has an
  // entry — total only the lines the quote still has.
  const currentLines = (routeData?.lines ?? []).flatMap((line) =>
    line.id && selectedLines[line.id] ? [selectedLines[line.id]] : []
  );

  const subtotal = currentLines.reduce((acc, line) => {
    return (
      acc +
      (line.convertedNetUnitPrice ?? 0) * line.quantity +
      (line.convertedAddOn ?? 0) +
      (line.convertedShippingCost ?? 0)
    );
  }, 0);
  const totalDiscount = currentLines.reduce((acc, line) => {
    return (
      acc +
      (line.convertedUnitPrice ?? 0) *
        line.quantity *
        (line.discountPercent ?? 0)
    );
  }, 0);
  const tax = currentLines.reduce((acc, line) => {
    return (
      acc +
      ((line.convertedNetUnitPrice ?? 0) * line.quantity +
        (line.convertedTaxableAddOn ?? 0) +
        (line.convertedShippingCost ?? 0)) *
        (line.taxPercent ?? 0)
    );
  }, 0);
  const convertedShippingCost =
    (routeData?.quote.exchangeRate ?? 1) *
    (routeData?.shipment?.shippingCost ?? 0);
  const total = subtotal + tax + convertedShippingCost;

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between items-center w-full">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-0">
              <span>{routeData?.quote.quoteId}</span>
              <RevisionSuffix revisionId={routeData?.quote.revisionId} />
            </CardTitle>

            <CardDescription>
              <Trans>Quote</Trans>
            </CardDescription>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <CustomerAvatar customerId={routeData?.quote.customerId ?? null} />
            {routeData?.quote?.expirationDate && (
              <span className="text-xs text-muted-foreground tracking-tight">
                Expires{" "}
                <DateTime
                  value={routeData?.quote.expirationDate}
                  variant="date"
                />
              </span>
            )}
          </div>
        </HStack>
      </CardHeader>
      <CardContent>
        <LineItems
          currencyCode={routeData?.quote.currencyCode ?? "USD"}
          locale={locale}
          formatter={formatter}
          selectedLines={selectedLines}
          onSelectQuantity={onSelectQuantity}
        />

        <VStack spacing={2} className="mt-8">
          <HStack className="justify-between text-sm text-muted-foreground w-full">
            <span>Subtotal:</span>
            <MotionMoney
              value={subtotal + totalDiscount}
              currency={routeData?.quote?.currencyCode ?? "USD"}
              decimalPlaces={currencyDecimals}
            />
          </HStack>
          {totalDiscount > 0 && (
            <HStack className="justify-between text-sm text-muted-foreground w-full">
              <span>Discount:</span>
              <span className="text-muted-foreground">
                -
                <MotionMoney
                  value={totalDiscount}
                  currency={routeData?.quote?.currencyCode ?? "USD"}
                  decimalPlaces={currencyDecimals}
                />
              </span>
            </HStack>
          )}
          <HStack className="justify-between text-sm text-muted-foreground w-full">
            <span>Tax:</span>
            <MotionMoney
              value={tax}
              currency={routeData?.quote?.currencyCode ?? "USD"}
              decimalPlaces={currencyDecimals}
            />
          </HStack>
          <HStack className="justify-between text-sm text-muted-foreground w-full">
            {convertedShippingCost > 0 ? (
              <>
                <VStack spacing={0}>
                  <span>Shipping:</span>
                  <Button
                    variant="link"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={onEditShippingCost}
                  >
                    <Trans>Edit Shipping</Trans>
                  </Button>
                </VStack>
                <MotionMoney
                  value={convertedShippingCost}
                  currency={routeData?.quote?.currencyCode ?? "USD"}
                  decimalPlaces={currencyDecimals}
                />
              </>
            ) : isEditable ? (
              <Button
                variant="link"
                size="sm"
                className="text-primary"
                onClick={onEditShippingCost}
              >
                <Trans>Add Shipping</Trans>
              </Button>
            ) : null}
          </HStack>
          <HStack className="justify-between text-xl font-semibold w-full">
            <span>Total:</span>
            <MotionMoney
              value={total}
              currency={routeData?.quote?.currencyCode ?? "USD"}
              decimalPlaces={currencyDecimals}
            />
          </HStack>
        </VStack>
      </CardContent>
    </Card>
  );
};

export default QuoteSummary;
