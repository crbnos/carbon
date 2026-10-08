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
  cn,
  Heading,
  HStack,
  TruncatedTooltipText,
  useViewport,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { motion } from "motion/react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { LuChevronRight, LuImage } from "react-icons/lu";
import { Link, useParams } from "react-router";
import {
  CustomerAvatar,
  DateTime,
  MotionMoney,
  RevisionSuffix
} from "~/components";
import { SummaryLineRow } from "~/components/SummaryLineRow";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
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
  getQuoteLineTotal,
  LinePricingOptions,
  type SelectedLine
} from "./QuoteLinePricingOptions";

const LineItems = ({
  currencyCode,
  formatter,
  locale,
  selectedLines,
  setSelectedLines
}: {
  currencyCode: string;
  formatter: Intl.NumberFormat;
  locale: string;
  selectedLines: Record<string, SelectedLine>;
  setSelectedLines: Dispatch<SetStateAction<Record<string, SelectedLine>>>;
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

  return (
    <VStack
      spacing={8}
      className={cn(
        "w-full overflow-hidden tracking-tight",
        isPhone && "space-y-0 divide-y divide-border"
      )}
    >
      {routeData?.lines?.map((line) => {
        const prices = pricingByLine[line.id!];

        if (!line || !prices || !line.id) {
          return null;
        }

        const selectedLine = selectedLines[line.id] || deselectedLine;
        const lineTotal = getQuoteLineTotal(selectedLine);
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
              setSelectedLines={setSelectedLines}
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
                description={line.description}
                meta={
                  selectedLine.quantity > 0 ? (
                    <>
                      {selectedLine.quantity} ×{" "}
                      {formatter.format(
                        selectedLine.convertedNetUnitPrice ?? 0
                      )}{" "}
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
                  className="w-24 h-24 shrink-0 bg-gradient-to-bl from-muted to-muted/40 rounded-lg max-md:size-14"
                  src={getPrivateUrl(line.thumbnailPath)}
                />
              ) : (
                <div className="w-24 h-24 shrink-0 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-4 max-md:size-14 max-md:p-3">
                  <LuImage className="w-16 h-16 text-muted-foreground max-md:size-8" />
                </div>
              )}

              <VStack spacing={0} className="flex-1 min-w-0">
                <div
                  className="flex flex-col cursor-pointer w-full"
                  onClick={() => toggleOpen(line.id!)}
                >
                  <div className="flex items-center gap-x-4 justify-between flex-grow max-md:flex-wrap max-md:gap-y-2">
                    <HStack spacing={2} className="min-w-0 flex-shrink">
                      <Heading className="truncate">
                        {line.itemReadableId}
                      </Heading>
                      <Button
                        asChild
                        variant="link"
                        size="sm"
                        className="text-muted-foreground flex-shrink-0"
                      >
                        <Link to={path.to.quoteLine(quoteId, line.id!)}>
                          Edit
                        </Link>
                      </Button>
                    </HStack>
                    <HStack spacing={4}>
                      <MotionMoney
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
                  <TruncatedTooltipText
                    className="text-muted-foreground text-sm truncate"
                    tooltip={line.description}
                  >
                    {line.description}
                  </TruncatedTooltipText>
                </div>
              </VStack>
            </HStack>

            {pricingOptions}
          </motion.div>
        );
      })}
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

  const [selectedLines, setSelectedLines] = useState<
    Record<string, SelectedLine>
  >(() => {
    return (
      routeData?.lines?.reduce<Record<string, SelectedLine>>((acc, line) => {
        const salesOrderLine = routeData?.salesOrderLines?.find(
          (salesOrderLine) => salesOrderLine.id === line.id
        );

        if (
          Array.isArray(routeData?.salesOrderLines) &&
          routeData?.salesOrderLines.length > 0 &&
          !salesOrderLine
        ) {
          acc[line.id!] = deselectedLine;
          return acc;
        }

        const price = salesOrderLine
          ? routeData?.prices?.find(
              (price) =>
                price.quoteLineId === salesOrderLine.id &&
                price.quantity === salesOrderLine.saleQuantity
            )
          : routeData?.prices?.find(
              (price) =>
                price.quoteLineId === line.id &&
                line.quantity?.includes(price.quantity)
            );
        if (!line.id) {
          return acc;
        }

        if (!price) {
          acc[line.id] = deselectedLine;
          return acc;
        }

        const additionalChargesByQuantity =
          line.quantity?.reduce(
            (acc, quantity) => {
              const charges = Object.values(
                line.additionalCharges ?? {}
              ).reduce((chargeAcc, charge) => {
                const amount = charge.amounts?.[quantity];
                return chargeAcc + amount;
              }, 0);
              acc[quantity] = charges;
              return acc;
            },
            {} as Record<number, number>
          ) ?? {};

        const convertedAdditionalChargesByQuantity =
          Object.entries(additionalChargesByQuantity).reduce<
            Record<number, number>
          >(
            (acc, [quantity, amount]) => {
              acc[Number(quantity)] =
                amount * (routeData?.quote.exchangeRate ?? 1);
              return acc;
            },
            {} as Record<number, number>
          ) ?? {};

        const taxableAdditionalChargesByQuantity =
          line.quantity?.reduce(
            (acc, quantity) => {
              const charges = Object.values(
                line.additionalCharges ?? {}
              ).reduce((chargeAcc, charge) => {
                if (charge.taxable === false) return chargeAcc;
                const amount = charge.amounts?.[quantity];
                return chargeAcc + amount;
              }, 0);
              acc[quantity] = charges;
              return acc;
            },
            {} as Record<number, number>
          ) ?? {};

        const convertedTaxableAdditionalChargesByQuantity =
          Object.entries(taxableAdditionalChargesByQuantity).reduce<
            Record<number, number>
          >(
            (acc, [quantity, amount]) => {
              acc[Number(quantity)] =
                amount * (routeData?.quote.exchangeRate ?? 1);
              return acc;
            },
            {} as Record<number, number>
          ) ?? {};

        acc[line.id] = {
          quantity: price.quantity ?? 0,
          netUnitPrice: price.netUnitPrice ?? 0,
          convertedNetUnitPrice: price.convertedNetUnitPrice ?? 0,
          addOn: additionalChargesByQuantity[price.quantity] || 0,
          convertedAddOn:
            convertedAdditionalChargesByQuantity[price.quantity] || 0,
          taxableAddOn: taxableAdditionalChargesByQuantity[price.quantity] || 0,
          convertedTaxableAddOn:
            convertedTaxableAdditionalChargesByQuantity[price.quantity] || 0,
          leadTime: price.leadTime,
          shippingCost: price.shippingCost ?? 0,
          convertedShippingCost: price.convertedShippingCost ?? 0,
          taxPercent: line.taxPercent ?? 0,
          discountPercent: price.discountPercent ?? 0,
          unitPrice: price.unitPrice ?? 0,
          convertedUnitPrice: price.convertedUnitPrice ?? 0
        };
        return acc;
      }, {}) ?? {}
    );
  });

  const subtotal = Object.values(selectedLines).reduce((acc, line) => {
    return (
      acc +
      (line.convertedNetUnitPrice ?? 0) * line.quantity +
      (line.convertedAddOn ?? 0) +
      (line.convertedShippingCost ?? 0)
    );
  }, 0);
  const totalDiscount = Object.values(selectedLines).reduce((acc, line) => {
    return (
      acc +
      (line.convertedUnitPrice ?? 0) *
        line.quantity *
        (line.discountPercent ?? 0)
    );
  }, 0);
  const tax = Object.values(selectedLines).reduce((acc, line) => {
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
          setSelectedLines={setSelectedLines}
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
