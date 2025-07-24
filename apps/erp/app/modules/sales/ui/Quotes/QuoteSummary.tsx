import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Heading,
  RadioGroup,
  RadioGroupItem,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { Link, useParams } from "@remix-run/react";
import { motion } from "framer-motion";
import MotionNumber from "motion-number";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { LuChevronRight, LuImage } from "react-icons/lu";
import { CustomerAvatar } from "~/components";
import { usePercentFormatter, useRouteData, useUser } from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";
import type {
  Quotation,
  QuotationLine,
  QuotationPrice,
  QuotationShipment,
  SalesOrderLine,
} from "../../types";

type SelectedLine = {
  quantity: number;
  netUnitPrice: number;
  convertedNetUnitPrice: number;
  addOn: number;
  convertedAddOn: number;
  leadTime: number;
  shippingCost: number;
  convertedShippingCost: number;
  taxPercent: number;
  discountPercent: number;
  unitPrice: number;
  convertedUnitPrice: number;
};

const deselectedLine: SelectedLine = {
  addOn: 0,
  convertedAddOn: 0,
  netUnitPrice: 0,
  convertedNetUnitPrice: 0,
  quantity: 0,
  leadTime: 0,
  shippingCost: 0,
  convertedShippingCost: 0,
  taxPercent: 0,
  discountPercent: 0,
  unitPrice: 0,
  convertedUnitPrice: 0,
};

const LineItems = ({
  currencyCode,
  formatter,
  locale,
  selectedLines,
  setSelectedLines,
}: {
  currencyCode: string;
  formatter: Intl.NumberFormat;
  locale: string;
  selectedLines: Record<string, SelectedLine>;
  setSelectedLines: Dispatch<SetStateAction<Record<string, SelectedLine>>>;
}) => {
  const { company } = useUser();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quote id");
  const routeData = useRouteData<{
    quote: Quotation;
    lines: QuotationLine[];
    prices: QuotationPrice[];
  }>(path.to.quote(quoteId));

  const [openItems, setOpenItems] = useState<string[]>([]);

  useEffect(() => {
    Object.entries(selectedLines).forEach(([lineId, line]) => {
      if (line.quantity === 0 && openItems.includes(lineId)) {
        setOpenItems((prev) => prev.filter((item) => item !== lineId));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLines]);

  const pricingByLine = useMemo(
    () =>
      routeData?.lines?.reduce<Record<string, QuotationPrice[]>>(
        (acc, line) => {
          if (!line.id) {
            return acc;
          }
          acc[line.id!] =
            routeData?.prices
              ?.filter((p) => p.quoteLineId === line.id)
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
    <VStack spacing={8} className="w-full overflow-hidden">
      {routeData?.lines?.map((line) => {
        const prices = pricingByLine[line.id!];

        if (!line || !prices || !line.id) {
          return null;
        }

        const selectedLine = selectedLines[line.id] || deselectedLine;

        return (
          <motion.div
            key={line.id}
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="border-b border-input py-6 w-full"
          >
            <HStack spacing={4} className="items-start">
              {line.thumbnailPath ? (
                <img
                  alt={line.itemReadableId!}
                  className="w-24 h-24 bg-gradient-to-bl from-muted to-muted/40 rounded-lg"
                  src={getPrivateUrl(line.thumbnailPath)}
                />
              ) : (
                <div className="w-24 h-24 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-4">
                  <LuImage className="w-16 h-16 text-muted-foreground" />
                </div>
              )}

              <VStack spacing={0} className="w-full">
                <div
                  className="flex flex-col cursor-pointer w-full"
                  onClick={() => toggleOpen(line.id!)}
                >
                  <div className="flex items-center gap-x-4 justify-between flex-grow">
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
                      <MotionNumber
                        className="font-bold text-xl"
                        value={
                          ((selectedLine.convertedNetUnitPrice ?? 0) *
                            (selectedLine.quantity ?? 0) +
                            (selectedLine.convertedAddOn ?? 0) +
                            (selectedLine.convertedShippingCost ?? 0)) *
                          (1 + (selectedLine.taxPercent ?? 0))
                        }
                        format={{
                          style: "currency",
                          currency: currencyCode,
                        }}
                        locales={locale}
                      />
                      <motion.div
                        animate={{
                          rotate: openItems.includes(line.id) ? 90 : 0,
                        }}
                        transition={{ duration: 0.3 }}
                      >
                        <LuChevronRight size={24} />
                      </motion.div>
                    </HStack>
                  </div>
                  <span className="text-muted-foreground text-base truncate">
                    {line.description}
                  </span>
                </div>
              </VStack>
            </HStack>

            <motion.div
              initial="collapsed"
              animate={openItems.includes(line.id) ? "open" : "collapsed"}
              variants={{
                open: { opacity: 1, height: "auto", marginTop: 16 },
                collapsed: { opacity: 0, height: 0, marginTop: 0 },
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
          </motion.div>
        );
      })}
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
  setSelectedLines: Dispatch<SetStateAction<Record<string, SelectedLine>>>;
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
  setSelectedLines,
}: LinePricingOptionsProps) => {
  const percentFormatter = usePercentFormatter();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quote id");
  const routeData = useRouteData<{
    quote: Quotation;
    salesOrderLines: SalesOrderLine[];
  }>(path.to.quote(quoteId));

  const [selectedValue, setSelectedValue] = useState<string | null>(
    selectedLine?.quantity?.toString() ?? null
  );

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
      amount: selectedLine.convertedShippingCost,
    });
  }
  Object.entries(line.additionalCharges ?? {}).forEach(([name, charge]) => {
    additionalCharges.push({
      name: charge.description,
      amount: charge.amounts?.[selectedLine.quantity] * quoteExchangeRate,
    });
  });

  return (
    <VStack spacing={4}>
      <RadioGroup
        className="w-full"
        value={selectedValue ?? undefined}
        disabled={["Ordered", "Partial", "Expired", "Cancelled"].includes(
          routeData?.quote.status ?? ""
        )}
        onValueChange={(value) => {
          const selectedOption =
            value === "0"
              ? deselectedLine
              : options.find((opt) => opt.quantity.toString() === value);

          if (selectedOption) {
            setSelectedLines((prev) => ({
              ...prev,
              [line.id!]: {
                quantity: selectedOption.quantity,
                netUnitPrice: selectedOption.netUnitPrice ?? 0,
                convertedNetUnitPrice:
                  selectedOption.convertedNetUnitPrice ?? 0,
                addOn:
                  additionalChargesByQuantity[selectedOption.quantity] || 0,
                convertedAddOn:
                  convertedAdditionalChargesByQuantity[
                    selectedOption.quantity
                  ] || 0,
                leadTime: selectedOption.leadTime,
                shippingCost: selectedOption.shippingCost ?? 0,
                convertedShippingCost:
                  selectedOption.convertedShippingCost ?? 0,
                taxPercent: line.taxPercent ?? 0,
                discountPercent: selectedOption.discountPercent ?? 0,
                unitPrice: selectedOption.unitPrice ?? 0,
                convertedUnitPrice: selectedOption.convertedUnitPrice ?? 0,
              },
            }));
            setSelectedValue(value);
          }
        }}
      >
        <Table>
          <Thead>
            <Tr>
              <Th />
              <Th>Quantity</Th>
              <Th>Unit Price</Th>
              <Th>Discount</Th>
              <Th>Add-Ons</Th>
              <Th>Lead Time</Th>
              <Th>Subtotal</Th>
            </Tr>
          </Thead>
          <Tbody>
            {!Array.isArray(options) || options.length === 0 ? (
              <Tr>
                <Td colSpan={6} className="text-center py-8">
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
                      <Td>
                        {formatter.format(
                          convertedAdditionalChargesByQuantity[
                            option.quantity
                          ] + (option.convertedShippingCost ?? 0)
                        )}
                      </Td>
                      <Td>
                        {new Intl.NumberFormat(locale, {
                          style: "unit",
                          unit: "day",
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
                <Td>Extended Price</Td>
                <Td className="text-right">
                  <MotionNumber
                    value={
                      (selectedLine.convertedUnitPrice ?? 0) *
                      selectedLine.quantity
                    }
                    format={{ style: "currency", currency: quoteCurrency }}
                    locales={locale}
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
                    <MotionNumber
                      value={
                        (selectedLine.convertedUnitPrice ?? 0) *
                        selectedLine.quantity *
                        selectedLine.discountPercent
                      }
                      format={{ style: "currency", currency: quoteCurrency }}
                      locales={locale}
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
                      <MotionNumber
                        value={charge.amount}
                        format={{ style: "currency", currency: quoteCurrency }}
                        locales={locale}
                      />
                    </Td>
                  </Tr>
                ))}

              <Tr key="subtotal">
                <Td>Subtotal</Td>
                <Td className="text-right">
                  <MotionNumber
                    value={
                      (selectedLine.convertedNetUnitPrice ?? 0) *
                        selectedLine.quantity +
                      (selectedLine.convertedAddOn ?? 0) +
                      (selectedLine.convertedShippingCost ?? 0)
                    }
                    format={{
                      style: "currency",
                      currency: quoteCurrency,
                    }}
                    locales={locale}
                  />
                </Td>
              </Tr>

              <Tr key="tax" className="border-b border-border">
                <Td>
                  Tax ({percentFormatter.format(selectedLine.taxPercent)})
                </Td>
                <Td className="text-right">
                  <MotionNumber
                    value={
                      ((selectedLine.convertedNetUnitPrice ?? 0) *
                        selectedLine.quantity +
                        (selectedLine.convertedAddOn ?? 0) +
                        (selectedLine.convertedShippingCost ?? 0)) *
                      (selectedLine.taxPercent ?? 0)
                    }
                    format={{
                      style: "currency",
                      currency: quoteCurrency,
                    }}
                    locales={locale}
                  />
                </Td>
              </Tr>

              <Tr key="total" className="font-bold">
                <Td>Total</Td>
                <Td className="text-right">
                  <MotionNumber
                    value={
                      ((selectedLine.convertedNetUnitPrice ?? 0) *
                        selectedLine.quantity +
                        (selectedLine.convertedAddOn ?? 0) +
                        (selectedLine.convertedShippingCost ?? 0)) *
                      (1 + (selectedLine.taxPercent ?? 0))
                    }
                    format={{
                      style: "currency",
                      currency: quoteCurrency,
                    }}
                    locales={locale}
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
  onEditShippingCost,
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

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.quote?.status ?? ""
  );

  const { locale } = useLocale();
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: routeData?.quote.currencyCode ?? "USD",
      }),
    [locale, routeData?.quote.currencyCode]
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
          line.quantity?.reduce((acc, quantity) => {
            const charges = Object.values(line.additionalCharges ?? {}).reduce(
              (chargeAcc, charge) => {
                const amount = charge.amounts?.[quantity];
                return chargeAcc + amount;
              },
              0
            );
            acc[quantity] = charges;
            return acc;
          }, {} as Record<number, number>) ?? {};

        const convertedAdditionalChargesByQuantity =
          Object.entries(additionalChargesByQuantity).reduce<
            Record<number, number>
          >((acc, [quantity, amount]) => {
            acc[Number(quantity)] =
              amount * (routeData?.quote.exchangeRate ?? 1);
            return acc;
          }, {} as Record<number, number>) ?? {};

        acc[line.id] = {
          quantity: price.quantity ?? 0,
          netUnitPrice: price.netUnitPrice ?? 0,
          convertedNetUnitPrice: price.convertedNetUnitPrice ?? 0,
          addOn: additionalChargesByQuantity[price.quantity] || 0,
          convertedAddOn:
            convertedAdditionalChargesByQuantity[price.quantity] || 0,
          leadTime: price.leadTime,
          shippingCost: price.shippingCost ?? 0,
          convertedShippingCost: price.convertedShippingCost ?? 0,
          taxPercent: line.taxPercent ?? 0,
          discountPercent: price.discountPercent ?? 0,
          unitPrice: price.unitPrice ?? 0,
          convertedUnitPrice: price.convertedUnitPrice ?? 0,
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
        (line.convertedAddOn ?? 0) +
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
              {(routeData?.quote.revisionId ?? 0) > 0 && (
                <span className="text-muted-foreground">
                  -{routeData?.quote.revisionId}
                </span>
              )}
            </CardTitle>

            <CardDescription>Quote</CardDescription>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <CustomerAvatar customerId={routeData?.quote.customerId ?? null} />
            {routeData?.quote?.expirationDate && (
              <span className="text-muted-foreground text-sm">
                Expires {formatDate(routeData?.quote.expirationDate)}
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
          <HStack className="justify-between text-base text-muted-foreground w-full">
            <span>Subtotal:</span>
            <MotionNumber
              value={subtotal + totalDiscount}
              format={{
                style: "currency",
                currency: routeData?.quote?.currencyCode ?? "USD",
              }}
              locales={locale}
            />
          </HStack>
          {totalDiscount > 0 && (
            <HStack className="justify-between text-base text-muted-foreground w-full">
              <span>Discount:</span>
              <span className="text-muted-foreground">
                -
                <MotionNumber
                  value={totalDiscount}
                  format={{
                    style: "currency",
                    currency: routeData?.quote?.currencyCode ?? "USD",
                  }}
                  locales={locale}
                />
              </span>
            </HStack>
          )}
          <HStack className="justify-between text-base text-muted-foreground w-full">
            <span>Tax:</span>
            <MotionNumber
              value={tax}
              format={{
                style: "currency",
                currency: routeData?.quote?.currencyCode ?? "USD",
              }}
              locales={locale}
            />
          </HStack>
          <HStack className="justify-between text-base text-muted-foreground w-full">
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
                    Edit Shipping
                  </Button>
                </VStack>
                <MotionNumber
                  value={convertedShippingCost}
                  format={{
                    style: "currency",
                    currency: routeData?.quote.currencyCode ?? "USD",
                  }}
                  locales={locale}
                />
              </>
            ) : isEditable ? (
              <Button
                variant="link"
                size="sm"
                className="text-muted-foreground"
                onClick={onEditShippingCost}
              >
                Add Shipping
              </Button>
            ) : null}
          </HStack>
          <HStack className="justify-between text-xl font-bold w-full">
            <span>Total:</span>
            <MotionNumber
              value={total}
              format={{
                style: "currency",
                currency: routeData?.quote.currencyCode ?? "USD",
              }}
              locales={locale}
            />
          </HStack>
        </VStack>
      </CardContent>
    </Card>
  );
};

export default QuoteSummary;
