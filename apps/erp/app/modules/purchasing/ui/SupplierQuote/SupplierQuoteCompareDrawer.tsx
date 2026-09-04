import type { Database } from "@carbon/database";
import {
  Badge,
  Button,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Heading,
  HStack,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  TruncatedTooltipText,
  VStack
} from "@carbon/react";
import { pluralize } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { LuArrowLeft, LuImage, LuStar } from "react-icons/lu";
import { Form, useFetcher, useNavigation } from "react-router";
import type { z } from "zod";
import { useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { getPrivateUrl, path } from "~/utils/path";
import type { selectedLineSchema } from "../../purchasing.models";
import type { SupplierQuoteLine, SupplierQuoteLinePrice } from "../../types";

type SelectedLine = z.infer<typeof selectedLineSchema>;

// Type for quotes returned from comparison API (includes supplier relation)
type ComparisonQuote = Database["public"]["Tables"]["supplierQuote"]["Row"] & {
  supplier: Database["public"]["Tables"]["supplier"]["Row"] | null;
};

type ComparisonData = {
  quotes: ComparisonQuote[];
  lines: SupplierQuoteLine[];
  prices: SupplierQuoteLinePrice[];
};

type SupplierQuoteCompareDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  purchasingRfqId: string;
};

type DrawerStep = "compare" | "select-items";

const SupplierQuoteCompareDrawer = ({
  isOpen,
  onClose,
  purchasingRfqId
}: SupplierQuoteCompareDrawerProps) => {
  const { t } = useLingui();
  const [step, setStep] = useState<DrawerStep>("compare");
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [selectedQuantityTier, setSelectedQuantityTier] = useState<
    number | null
  >(null);
  const [selectedLines, setSelectedLines] = useState<
    Record<string, SelectedLine>
  >({});

  const fetcher = useFetcher<ComparisonData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const formatter = useCurrencyFormatter({ currency: baseCurrency });

  // Load comparison data when drawer opens
  useEffect(() => {
    if (
      isOpen &&
      purchasingRfqId &&
      fetcher.state === "idle" &&
      !fetcher.data
    ) {
      fetcher.load(path.to.purchasingRfqCompare(purchasingRfqId));
    }
  }, [isOpen, purchasingRfqId, fetcher]);

  // Reset state when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setStep("compare");
      setSelectedQuoteId(null);
      setSelectedQuantityTier(null);
      setSelectedLines({});
    }
  }, [isOpen]);

  const quotes = fetcher.data?.quotes ?? [];
  const lines = fetcher.data?.lines ?? [];
  const prices = fetcher.data?.prices ?? [];

  // Calculate submission stats for header
  const totalQuotes = quotes.length;
  const submittedQuotes = quotes.filter((q) => q.status === "Active").length;

  // Get all unique quantity tiers across all quotes
  const quantityTiers = useMemo(() => {
    const tiers = new Set<number>();
    for (const price of prices) {
      tiers.add(price.quantity);
    }
    return Array.from(tiers).sort((a, b) => a - b);
  }, [prices]);

  // Set default quantity tier to first available
  useEffect(() => {
    if (quantityTiers.length > 0 && selectedQuantityTier === null) {
      setSelectedQuantityTier(quantityTiers[0]);
    }
  }, [quantityTiers, selectedQuantityTier]);

  const selectedQuote = useMemo(
    () => quotes.find((q) => q.id === selectedQuoteId),
    [quotes, selectedQuoteId]
  );

  const selectedQuoteLines = useMemo(
    () => lines.filter((l) => l.supplierQuoteId === selectedQuoteId),
    [lines, selectedQuoteId]
  );

  const selectedQuotePrices = useMemo(
    () => prices.filter((p) => p.supplierQuoteId === selectedQuoteId),
    [prices, selectedQuoteId]
  );

  const handleQuoteSelect = (quoteId: string) => {
    setSelectedQuoteId(quoteId);
  };

  const handleProceedToSelectItems = () => {
    if (selectedQuoteId) {
      setStep("select-items");
    }
  };

  const handleBackToCompare = () => {
    setStep("compare");
    setSelectedLines({});
  };

  // Calculate order total from selected line items. Base currency: the lines
  // can come from suppliers quoting in different currencies, so the supplier*
  // columns are not addable — unitPrice/shippingCost/taxAmount are each the
  // supplier figure over the quote's exchangeRate.
  const orderTotal = useMemo(() => {
    let total = 0;
    for (const pricing of Object.values(selectedLines)) {
      total +=
        pricing.unitPrice * pricing.quantity +
        pricing.shippingCost +
        pricing.taxAmount;
    }
    return total;
  }, [selectedLines]);

  const isLoading = fetcher.state === "loading";

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DrawerContent size="xl">
        <DrawerHeader>
          <HStack className="w-full justify-between">
            <HStack>
              {step === "select-items" && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<LuArrowLeft />}
                  onClick={handleBackToCompare}
                >
                  <Trans>Back</Trans>
                </Button>
              )}
              <VStack spacing={0} className="items-start">
                <DrawerTitle>
                  {step === "compare"
                    ? t`Compare Supplier Quotes`
                    : `Create Order from ${
                        selectedQuote?.supplier?.name ??
                        selectedQuote?.supplierQuoteId
                      }`}
                </DrawerTitle>
                {step === "compare" && totalQuotes > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {submittedQuotes} out of {totalQuotes} submitted
                  </span>
                )}
              </VStack>
            </HStack>

            {/* Quantity tier selector in Step 1 */}
            {step === "compare" && quantityTiers.length > 1 && (
              <HStack>
                <span className="text-sm text-muted-foreground">
                  <Trans>Compare at quantity:</Trans>
                </span>
                <Select
                  value={String(selectedQuantityTier ?? "")}
                  onValueChange={(value) =>
                    setSelectedQuantityTier(Number(value))
                  }
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {quantityTiers.map((qty) => (
                      <SelectItem key={qty} value={String(qty)}>
                        {qty}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </HStack>
            )}
          </HStack>
        </DrawerHeader>

        <DrawerBody>
          {isLoading ? (
            <div className="flex w-full h-full items-center justify-center">
              <Spinner className="h-10 w-10" />
            </div>
          ) : quotes.length === 0 ? (
            <div className="flex w-full h-full items-center justify-center">
              <VStack spacing={2} className="text-center">
                <Heading size="h4">
                  <Trans>No Active Quotes</Trans>
                </Heading>
                <p className="text-muted-foreground">
                  <Trans>
                    There are no active supplier quotes to compare for this RFQ.
                  </Trans>
                </p>
              </VStack>
            </div>
          ) : step === "compare" ? (
            <ComparisonView
              quotes={quotes}
              lines={lines}
              prices={prices}
              selectedQuoteId={selectedQuoteId}
              selectedQuantityTier={selectedQuantityTier}
              onQuoteSelect={handleQuoteSelect}
              formatter={formatter}
            />
          ) : (
            <LineSelectionView
              quote={selectedQuote!}
              lines={selectedQuoteLines}
              prices={selectedQuotePrices}
              selectedLines={selectedLines}
              setSelectedLines={setSelectedLines}
              formatter={formatter}
            />
          )}
        </DrawerBody>

        <DrawerFooter>
          <HStack className="w-full justify-between">
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>

            {step === "compare" ? (
              <Button
                onClick={handleProceedToSelectItems}
                isDisabled={!selectedQuoteId}
              >
                Select Items →
              </Button>
            ) : (
              <Form
                action={path.to.convertSupplierQuoteToOrder(selectedQuoteId!)}
                method="post"
              >
                <input
                  type="hidden"
                  name="selectedLines"
                  value={JSON.stringify(selectedLines)}
                />
                <Button
                  type="submit"
                  isDisabled={
                    isSubmitting || Object.keys(selectedLines).length === 0
                  }
                  isLoading={isSubmitting}
                >
                  Create Order ({formatter.format(orderTotal)})
                </Button>
              </Form>
            )}
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export default SupplierQuoteCompareDrawer;

// --- Comparison View Component ---

type ComparisonViewProps = {
  quotes: ComparisonQuote[];
  lines: SupplierQuoteLine[];
  prices: SupplierQuoteLinePrice[];
  selectedQuoteId: string | null;
  selectedQuantityTier: number | null;
  onQuoteSelect: (quoteId: string) => void;
  formatter: Intl.NumberFormat;
};

const ComparisonView = ({
  quotes,
  lines,
  prices,
  selectedQuoteId,
  selectedQuantityTier,
  onQuoteSelect,
  formatter
}: ComparisonViewProps) => {
  // Group lines and prices by quote, filtered by selected quantity tier
  const quoteData = useMemo(() => {
    return quotes.map((quote) => {
      const quoteLines = lines.filter((l) => l.supplierQuoteId === quote.id);
      const quotePrices = prices.filter((p) => p.supplierQuoteId === quote.id);

      // Calculate quote total for selected quantity tier
      let total = 0;
      let minLeadTime = Infinity;
      let maxLeadTime = 0;
      let hasMatchingTier = false;

      for (const line of quoteLines) {
        // Find price matching selected quantity tier, or closest available
        const linePrices = quotePrices.filter(
          (p) => p.supplierQuoteLineId === line.id
        );

        const matchingPrice = selectedQuantityTier
          ? linePrices.find((p) => p.quantity === selectedQuantityTier)
          : linePrices[0];

        if (matchingPrice) {
          hasMatchingTier = true;
          // Base currency — this total is compared against every other
          // supplier's to pick `bestTotal`, and each supplier may quote in its
          // own currency. Comparing raw supplier* amounts ranks by exchange
          // rate rather than by price.
          total +=
            (matchingPrice.unitPrice ?? 0) * matchingPrice.quantity +
            (matchingPrice.shippingCost ?? 0) +
            (matchingPrice.taxAmount ?? 0);

          if (
            matchingPrice.leadTime !== null &&
            matchingPrice.leadTime !== undefined
          ) {
            minLeadTime = Math.min(minLeadTime, matchingPrice.leadTime);
            maxLeadTime = Math.max(maxLeadTime, matchingPrice.leadTime);
          }
        }
      }

      return {
        quote,
        lines: quoteLines,
        prices: quotePrices,
        total,
        hasMatchingTier,
        leadTimeRange:
          minLeadTime === Infinity
            ? null
            : minLeadTime === maxLeadTime
              ? `${minLeadTime} ${pluralize(minLeadTime, "day")}`
              : `${minLeadTime}-${maxLeadTime} days`
      };
    });
  }, [quotes, lines, prices, selectedQuantityTier]);

  // Find best total for highlighting
  const bestTotal = useMemo(() => {
    const totals = quoteData
      .filter((q) => q.hasMatchingTier)
      .map((q) => q.total)
      .filter((t) => t > 0);
    return totals.length > 0 ? Math.min(...totals) : null;
  }, [quoteData]);

  // Get unique items across all quotes for the comparison matrix
  const uniqueItems = useMemo(() => {
    const itemMap = new Map<
      string,
      { itemReadableId: string; description: string }
    >();
    for (const line of lines) {
      if (line.itemReadableId && !itemMap.has(line.itemReadableId)) {
        itemMap.set(line.itemReadableId, {
          itemReadableId: line.itemReadableId,
          description: line.description ?? ""
        });
      }
    }
    return Array.from(itemMap.values());
  }, [lines]);

  return (
    <ScrollArea className="h-[calc(100dvh-180px)]">
      <VStack spacing={8}>
        {/* Quote Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 w-full">
          <RadioGroup
            value={selectedQuoteId ?? ""}
            onValueChange={onQuoteSelect}
            className="contents"
          >
            {quoteData.map(
              ({ quote, total, leadTimeRange, hasMatchingTier }) => (
                <label
                  key={quote.id}
                  htmlFor={`quote-${quote.id}`}
                  className={cn(
                    "relative flex flex-col p-4 rounded-lg border-2 cursor-pointer transition-all",
                    selectedQuoteId === quote.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/50",
                    !hasMatchingTier && "opacity-50"
                  )}
                >
                  <div className="absolute top-3 right-3">
                    <RadioGroupItem
                      value={quote.id!}
                      id={`quote-${quote.id}`}
                    />
                  </div>

                  <VStack spacing={2} className="items-start">
                    <div>
                      <Heading size="h4">
                        {quote.supplier?.name ?? "Unknown Supplier"}
                      </Heading>
                      <span className="text-sm text-muted-foreground">
                        {quote.supplierQuoteId}
                      </span>
                    </div>

                    <Badge variant="secondary">{quote.status}</Badge>

                    <div className="w-full pt-2 border-t space-y-1">
                      <HStack className="justify-between">
                        <span className="text-sm text-muted-foreground">
                          <Trans>Total:</Trans>
                        </span>
                        <HStack spacing={1}>
                          {total === bestTotal && total > 0 && (
                            <LuStar className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                          )}
                          <span
                            className={cn(
                              "font-semibold",
                              total === bestTotal &&
                                total > 0 &&
                                "text-green-600"
                            )}
                          >
                            {hasMatchingTier ? formatter.format(total) : "N/A"}
                          </span>
                        </HStack>
                      </HStack>

                      {leadTimeRange && (
                        <HStack className="justify-between">
                          <span className="text-sm text-muted-foreground">
                            <Trans>Lead Time:</Trans>
                          </span>
                          <span className="text-sm">{leadTimeRange}</span>
                        </HStack>
                      )}

                      {!hasMatchingTier && (
                        <span className="text-xs text-amber-600">
                          <Trans>No pricing for selected quantity</Trans>
                        </span>
                      )}
                    </div>
                  </VStack>
                </label>
              )
            )}
          </RadioGroup>
        </div>

        {/* Line Item Comparison Matrix */}
        {uniqueItems.length > 0 && (
          <VStack spacing={2} className="w-full">
            <Heading size="h4" className="self-start">
              <Trans>Line Item Comparison</Trans>
            </Heading>

            <div className="w-full overflow-x-auto border border-border rounded-md">
              <Table>
                <Thead>
                  <Tr>
                    <Th className="min-w-[150px]">
                      <Trans>Item</Trans>
                    </Th>
                    {quotes.map((quote) => (
                      <Th key={quote.id} className="min-w-[180px] text-center">
                        {quote.supplier?.name ?? "Unknown"}
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {uniqueItems.map((item) => {
                    // Find best price for this item at selected quantity tier
                    const itemPrices = quotes.map((quote) => {
                      const quoteLine = lines.find(
                        (l) =>
                          l.supplierQuoteId === quote.id &&
                          l.itemReadableId === item.itemReadableId
                      );
                      if (!quoteLine) return null;

                      const linePrices = prices.filter(
                        (p) => p.supplierQuoteLineId === quoteLine.id
                      );
                      const matchingPrice = selectedQuantityTier
                        ? linePrices.find(
                            (p) => p.quantity === selectedQuantityTier
                          )
                        : linePrices[0];

                      // Base currency: these are min'd across suppliers below,
                      // and each may quote in its own.
                      return matchingPrice?.unitPrice ?? null;
                    });

                    const validPrices = itemPrices.filter(
                      (p): p is number => p !== null && p > 0
                    );
                    const bestPrice =
                      validPrices.length > 0 ? Math.min(...validPrices) : null;

                    return (
                      <Tr key={item.itemReadableId}>
                        <Td>
                          <VStack spacing={0} className="items-start">
                            <span className="font-medium">
                              {item.itemReadableId}
                            </span>
                            <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                              {item.description}
                            </span>
                          </VStack>
                        </Td>
                        {quotes.map((quote) => {
                          const quoteLine = lines.find(
                            (l) =>
                              l.supplierQuoteId === quote.id &&
                              l.itemReadableId === item.itemReadableId
                          );
                          if (!quoteLine) {
                            return (
                              <Td key={quote.id} className="text-center">
                                <span className="text-muted-foreground">—</span>
                              </Td>
                            );
                          }

                          const linePrices = prices.filter(
                            (p) => p.supplierQuoteLineId === quoteLine.id
                          );
                          const linePrice = selectedQuantityTier
                            ? linePrices.find(
                                (p) => p.quantity === selectedQuantityTier
                              )
                            : linePrices[0];

                          if (!linePrice) {
                            return (
                              <Td key={quote.id} className="text-center">
                                <span className="text-muted-foreground text-xs">
                                  N/A
                                </span>
                              </Td>
                            );
                          }

                          const isBest =
                            linePrice.unitPrice === bestPrice &&
                            bestPrice !== null;

                          return (
                            <Td key={quote.id} className="text-center">
                              <VStack spacing={0}>
                                <HStack spacing={1} className="justify-center">
                                  {isBest && (
                                    <LuStar className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                                  )}
                                  <span
                                    className={cn(
                                      "font-medium",
                                      isBest && "text-green-600"
                                    )}
                                  >
                                    {formatter.format(linePrice.unitPrice ?? 0)}
                                    /ea
                                  </span>
                                </HStack>
                                <span className="text-xs text-muted-foreground">
                                  {linePrice.leadTime ?? 0}{" "}
                                  {pluralize(linePrice.leadTime ?? 0, "day")}
                                </span>
                              </VStack>
                            </Td>
                          );
                        })}
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            </div>
          </VStack>
        )}
      </VStack>
    </ScrollArea>
  );
};

// --- Line Selection View Component (matching existing drawer) ---

type LineSelectionViewProps = {
  quote: ComparisonQuote;
  lines: SupplierQuoteLine[];
  prices: SupplierQuoteLinePrice[];
  selectedLines: Record<string, SelectedLine>;
  setSelectedLines: React.Dispatch<
    React.SetStateAction<Record<string, SelectedLine>>
  >;
  formatter: Intl.NumberFormat;
};

const LineSelectionView = ({
  lines,
  prices,
  selectedLines,
  setSelectedLines,
  formatter
}: LineSelectionViewProps) => {
  const pricingByLine = useMemo(
    () =>
      lines.reduce<Record<string, SupplierQuoteLinePrice[]>>((acc, line) => {
        acc[line.id!] = prices.filter((p) => p.supplierQuoteLineId === line.id);
        return acc;
      }, {}),
    [lines, prices]
  );

  return (
    <ScrollArea className="h-[calc(100dvh-180px)]">
      <VStack spacing={8}>
        {lines.map((line) => (
          <VStack key={line.id}>
            <HStack spacing={2} className="items-start">
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

              {/* flex-1 + min-w-0, not VStack's default w-full: `width: 100%`
                  on a flex item resolves against the row's full width and
                  ignores the thumbnail beside it, pushing the description past
                  the card edge. min-w-0 is what lets truncate bite. */}
              <VStack spacing={0} className="flex-1 min-w-0">
                <Heading className="min-w-0">{line.itemReadableId}</Heading>
                <TruncatedTooltipText
                  className="text-muted-foreground text-base truncate"
                  tooltip={line.description}
                >
                  {line.description}
                </TruncatedTooltipText>
              </VStack>
            </HStack>

            <LinePricingOptions
              line={line}
              options={pricingByLine[line.id!] ?? []}
              formatter={formatter}
              selectedLines={selectedLines}
              setSelectedLines={setSelectedLines}
            />
          </VStack>
        ))}
      </VStack>
    </ScrollArea>
  );
};

// --- Line Pricing Options (matching existing drawer pattern) ---

type LinePricingOptionsProps = {
  line: SupplierQuoteLine;
  options: SupplierQuoteLinePrice[];
  formatter: Intl.NumberFormat;
  selectedLines: Record<string, SelectedLine>;
  setSelectedLines: React.Dispatch<
    React.SetStateAction<Record<string, SelectedLine>>
  >;
};

const LinePricingOptions = ({
  line,
  options,
  formatter,
  selectedLines,
  setSelectedLines
}: LinePricingOptionsProps) => {
  const selectedValue = selectedLines[line.id!]?.quantity?.toString() ?? "";

  return (
    <RadioGroup
      className="w-full"
      value={selectedValue}
      onValueChange={(value) => {
        const selectedOption = options.find(
          (opt) => opt.quantity.toString() === value
        );
        if (selectedOption) {
          setSelectedLines((prev) => ({
            ...prev,
            [line.id!]: {
              quantity: selectedOption.quantity,
              unitPrice: selectedOption.unitPrice ?? 0,
              supplierUnitPrice: selectedOption.supplierUnitPrice ?? 0,
              supplierShippingCost: selectedOption.supplierShippingCost ?? 0,
              shippingCost: selectedOption.shippingCost ?? 0,
              leadTime: selectedOption.leadTime ?? 0,
              supplierTaxAmount: selectedOption.supplierTaxAmount ?? 0,
              taxAmount: selectedOption.taxAmount ?? 0,
              taxPercent: selectedOption.taxPercent ?? 0
            }
          }));
        }
      }}
    >
      <div className="w-full border border-border rounded-md overflow-hidden">
        <Table className=" w-full ">
          <Thead>
            <Tr>
              <Th></Th>
              <Th>
                <Trans>Quantity</Trans>
              </Th>
              <Th>
                <Trans>Unit Price</Trans>
              </Th>
              <Th>
                <Trans>Shipping</Trans>
              </Th>
              <Th>
                <Trans>Lead Time</Trans>
              </Th>
              <Th>
                <Trans>Tax</Trans>
              </Th>
              <Th>
                <Trans>Total Price</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {!Array.isArray(options) || options.length === 0 ? (
              <Tr>
                <Td colSpan={7} className="text-center py-8">
                  <Trans>No pricing options found</Trans>
                </Td>
              </Tr>
            ) : (
              options.map((option) => (
                <Tr key={option.quantity}>
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
                  <Td>{formatter.format(option.unitPrice ?? 0)}</Td>
                  <Td>{formatter.format(option.shippingCost ?? 0)}</Td>
                  <Td>
                    {option.leadTime ?? 0}{" "}
                    {pluralize(option.leadTime ?? 0, "day")}
                  </Td>
                  <Td>{formatter.format(option.taxAmount ?? 0)}</Td>
                  <Td>
                    {formatter.format(
                      (option.unitPrice ?? 0) * option.quantity +
                        (option.shippingCost ?? 0) +
                        (option.taxAmount ?? 0)
                    )}
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
      </div>
    </RadioGroup>
  );
};
