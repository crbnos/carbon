import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  Input,
  NumberField,
  NumberInput,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  VStack,
} from "@carbon/react";
import { useFetcher, useParams, useSubmit } from "@remix-run/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuChevronDown,
  LuCirclePlus,
  LuInfo,
  LuRefreshCcw,
  LuTrash,
} from "react-icons/lu";
import type { z } from "zod";
import {
  useCurrencyFormatter,
  usePermissions,
  useRouteData,
  useUser,
} from "~/hooks";
import { path } from "~/utils/path";
import { quoteLineAdditionalChargesValidator } from "../../sales.models";
import type {
  Costs,
  Quotation,
  QuotationLine,
  QuotationPrice,
} from "../../types";

const QuoteLinePricing = ({
  line,
  pricesByQuantity,
  exchangeRate,
  getLineCosts,
}: {
  line: QuotationLine;
  pricesByQuantity: Record<number, QuotationPrice>;
  exchangeRate: number;
  getLineCosts: (quantity: number) => Costs;
}) => {
  const permissions = usePermissions();

  const isMade = line.methodType === "Make";
  const quantities = line.quantity ?? [1];

  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  // Consolidated state for all editable fields
  const [editableFields, setEditableFields] = useState({
    prices: pricesByQuantity,
    unitCost: line.unitCost ?? 0,
    additionalCharges: line.additionalCharges || {},
    taxPercent: line.taxPercent ?? 0,
  });

  const submit = useSubmit();

  useEffect(() => {
    setEditableFields((prev) => ({
      ...prev,
      prices: pricesByQuantity,
      unitCost: line.unitCost ?? 0,
      additionalCharges: line.additionalCharges || {},
      taxPercent: line.taxPercent ?? 0,
    }));
  }, [
    pricesByQuantity,
    line.unitCost,
    line.additionalCharges,
    line.taxPercent,
  ]);

  const unitPricePrecision = line.unitPricePrecision ?? 2;

  const routeData = useRouteData<{
    quote: Quotation;
  }>(path.to.quote(quoteId));
  const isEmployee = permissions.is("employee");
  const isEditable =
    permissions.can("update", "sales") &&
    isEmployee &&
    ["Draft"].includes(routeData?.quote?.status ?? "");

  const fetcher = useFetcher<{ id?: string; error: string | null }>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data]);

  const optimisticUnitCost = useMemo<number>(() => {
    if (!line.itemId) return editableFields.unitCost;
    if (fetcher.formAction === path.to.itemCostUpdate(line.itemId)) {
      const submitted = fetcher.formData?.get("unitCost");
      if (submitted) {
        return Number(submitted);
      }
    }
    return editableFields.unitCost;
  }, [
    line.itemId,
    editableFields.unitCost,
    fetcher.formAction,
    fetcher.formData,
  ]);

  const { id: userId, company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const formatter = useCurrencyFormatter();
  const unitPriceFormatter = useCurrencyFormatter({
    currency: routeData?.quote?.currencyCode ?? baseCurrency,
    maximumFractionDigits: unitPricePrecision,
  });
  const presentationCurrencyFormatter = useCurrencyFormatter({
    currency: routeData?.quote?.currencyCode ?? baseCurrency,
    maximumFractionDigits: unitPricePrecision,
  });

  const additionalCharges = useMemo(() => {
    if (fetcher.formAction === path.to.quoteLineCost(quoteId, lineId)) {
      // get the optimistic update
      return JSON.parse(
        (fetcher.formData?.get("additionalCharges") as string) ?? "{}"
      ) as z.infer<typeof quoteLineAdditionalChargesValidator>;
    }
    const parsedAdditionalCharges =
      quoteLineAdditionalChargesValidator.safeParse(
        editableFields.additionalCharges
      );

    return parsedAdditionalCharges.success ? parsedAdditionalCharges.data : {};
  }, [
    editableFields.additionalCharges,
    fetcher.formAction,
    fetcher.formData,
    lineId,
    quoteId,
  ]);

  const additionalChargesByQuantity = quantities.map((quantity) => {
    const charges = Object.values(additionalCharges).reduce((acc, charge) => {
      const amount = charge.amounts?.[quantity] ?? 0;
      return acc + amount;
    }, 0);
    return charges;
  });

  // Submission function using useSubmit with fetcherKey
  const submitFieldUpdates = useCallback(
    (action: string, data: Record<string, any>) => {
      const formData = new FormData();
      Object.entries(data).forEach(([key, value]) => {
        formData.append(
          key,
          typeof value === "object" ? JSON.stringify(value) : String(value)
        );
      });

      submit(formData, {
        method: "post",
        action,
        navigate: false,
        fetcherKey: `quote-line-pricing-${lineId}`,
      });
    },
    [submit, lineId]
  );

  const onUpdateChargeDescription = useCallback(
    (chargeId: string, description: string) => {
      const updatedCharges = {
        ...additionalCharges,
        [chargeId]: {
          ...additionalCharges[chargeId],
          description,
        },
      };

      // Update local state
      setEditableFields((prev) => ({
        ...prev,
        additionalCharges: updatedCharges,
      }));

      // Submit using the new submission function
      submitFieldUpdates(path.to.quoteLineCost(quoteId, lineId), {
        additionalCharges: updatedCharges,
      });
    },
    [additionalCharges, submitFieldUpdates, lineId, quoteId]
  );

  const onUpdateChargeAmount = useCallback(
    (chargeId: string, quantity: number, amount: number) => {
      const updatedCharges = {
        ...additionalCharges,
        [chargeId]: {
          ...additionalCharges[chargeId],
          amounts: {
            ...additionalCharges[chargeId].amounts,
            [quantity]: amount,
          },
        },
      };

      // Update local state
      setEditableFields((prev) => ({
        ...prev,
        additionalCharges: updatedCharges,
      }));

      // Submit using the new submission function
      submitFieldUpdates(path.to.quoteLineCost(quoteId, lineId), {
        additionalCharges: updatedCharges,
      });
    },
    [additionalCharges, submitFieldUpdates, lineId, quoteId]
  );

  const unitCostsByQuantity = quantities.map((quantity, index) => {
    const costs = getLineCosts(quantity);
    const totalCost =
      (costs.consumableCost +
        costs.laborCost +
        costs.machineCost +
        costs.materialCost +
        costs.overheadCost +
        costs.partCost +
        costs.serviceCost +
        costs.toolCost +
        costs.outsideCost) /
      quantity;
    return totalCost;
  });

  const netPricesByQuantity = quantities.map((quantity, index) => {
    const price = editableFields.prices[quantity]?.unitPrice ?? 0;
    const discount = editableFields.prices[quantity]?.discountPercent ?? 0;
    const netPrice = price * (1 - discount);
    return netPrice;
  });

  const onRecalculate = (markup: number) => {
    const formData = new FormData();
    formData.append("markup", markup.toString());
    formData.append("unitCostsByQuantity", JSON.stringify(unitCostsByQuantity));
    formData.append("quantities", JSON.stringify(quantities));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.quoteLineRecalculatePrice(quoteId, lineId),
    });
  };

  const onUpdatePrecision = (precision: number | string) => {
    const formData = new FormData();
    formData.append("precision", precision.toString());
    fetcher.submit(formData, {
      method: "post",
      action: path.to.quoteLineUpdatePrecision(quoteId, lineId),
    });
  };

  const onUpdateCost = useCallback(
    (value: number) => {
      if (!line.itemId) return;

      // Update local state
      setEditableFields((prev) => ({
        ...prev,
        unitCost: value,
      }));

      // Submit using the new submission function
      submitFieldUpdates(path.to.itemCostUpdate(line.itemId), {
        unitCost: value,
      });
    },
    [line.itemId, submitFieldUpdates]
  );

  const onUpdatePrice = useCallback(
    (
      key: "leadTime" | "unitPrice" | "discountPercent" | "shippingCost",
      quantity: number,
      value: number
    ) => {
      const unitPricePrecision = line.unitPricePrecision ?? 2;

      const hasPrice = !!editableFields.prices[quantity];
      const oldPrices = { ...editableFields.prices };
      const newPrices = { ...oldPrices };
      if (!hasPrice) {
        newPrices[quantity] = {
          quoteId,
          quoteLineId: lineId,
          quantity,
          leadTime: 0,
          unitPrice: 0,
          discountPercent: 0,
          exchangeRate: exchangeRate ?? 1,
          shippingCost: 0,
          createdBy: userId,
        } as unknown as QuotationPrice;
      }
      let roundedValue = value;
      if (key === "unitPrice") {
        // Round the value to the precision of the quote line
        roundedValue = Number(value.toFixed(unitPricePrecision));
      }
      newPrices[quantity] = { ...newPrices[quantity], [key]: roundedValue };

      // Update local state
      setEditableFields((prev) => ({
        ...prev,
        prices: newPrices,
      }));

      // Submit using the new submission function
      const submitData: Record<string, any> = {
        hasPrice: hasPrice.toString(),
        quantity: quantity.toString(),
        quoteLineId: lineId,
      };

      if (hasPrice) {
        submitData.key = key;
        submitData.value = roundedValue.toString();
      } else {
        submitData.price = JSON.stringify(newPrices[quantity]);
      }

      submitFieldUpdates(
        path.to.quoteLinePriceUpdate(quoteId, lineId),
        submitData
      );
    },
    [
      editableFields.prices,
      line.unitPricePrecision,
      quoteId,
      lineId,
      exchangeRate,
      userId,
      submitFieldUpdates,
    ]
  );

  return (
    <Card>
      <HStack className="justify-between">
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
        </CardHeader>
        {isEditable && (
          <CardAction>
            <HStack>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    rightIcon={<LuChevronDown />}
                    isLoading={
                      fetcher.state === "loading" &&
                      fetcher.formAction ===
                        path.to.quoteLineUpdatePrecision(quoteId, lineId)
                    }
                    isDisabled={
                      !isEditable ||
                      (fetcher.state === "loading" &&
                        fetcher.formAction ===
                          path.to.quoteLineUpdatePrecision(quoteId, lineId))
                    }
                  >
                    Precision
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup
                    value={unitPricePrecision.toString()}
                    onValueChange={(value) => onUpdatePrecision(value)}
                  >
                    <DropdownMenuRadioItem value="2">.00</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="3">
                      .000
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="4">
                      .0000
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    leftIcon={<LuRefreshCcw />}
                    rightIcon={<LuChevronDown />}
                    isLoading={
                      fetcher.state === "loading" &&
                      fetcher.formAction ===
                        path.to.quoteLineRecalculatePrice(quoteId, lineId)
                    }
                    isDisabled={
                      !isEditable ||
                      (fetcher.state === "loading" &&
                        fetcher.formAction ===
                          path.to.quoteLineRecalculatePrice(quoteId, lineId))
                    }
                  >
                    Recalculate
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onRecalculate(0)}>
                    0% Markup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRecalculate(10)}>
                    10% Markup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRecalculate(15)}>
                    15% Markup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRecalculate(20)}>
                    20% Markup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRecalculate(30)}>
                    30% Markup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRecalculate(40)}>
                    40% Markup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRecalculate(50)}>
                    50% Markup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRecalculate(60)}>
                    60% Markup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRecalculate(70)}>
                    70% Markup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRecalculate(80)}>
                    80% Markup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRecalculate(90)}>
                    90% Markup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRecalculate(100)}>
                    100% Markup
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </HStack>
          </CardAction>
        )}
      </HStack>
      <CardContent>
        <Table>
          <Thead>
            <Tr>
              <Th className="w-[300px]" />
              {quantities.map((quantity) => (
                <Th key={quantity.toString()}>{quantity}</Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            <Tr>
              <Td className="border-r border-border group-hover:bg-muted/50">
                <HStack className="w-full justify-between ">
                  <span>Lead Time</span>
                </HStack>
              </Td>
              {quantities.map((quantity) => {
                const leadTime = editableFields.prices[quantity]?.leadTime ?? 0;
                return (
                  <Td
                    key={quantity.toString()}
                    className="group-hover:bg-muted/50"
                  >
                    <NumberField
                      value={leadTime}
                      formatOptions={{
                        style: "unit",
                        unit: "day",
                        unitDisplay: "long",
                      }}
                      minValue={0}
                      onChange={(value) => {
                        if (Number.isFinite(value) && value !== leadTime) {
                          onUpdatePrice("leadTime", quantity, value);
                        }
                      }}
                    >
                      <NumberInput
                        className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                        isDisabled={!isEditable}
                        size="sm"
                        min={0}
                      />
                    </NumberField>
                  </Td>
                );
              })}
            </Tr>
            {isEmployee && (
              <Tr className={cn(isMade && "[&>td]:bg-muted/60")}>
                <Td className="border-r border-border group-hover:bg-muted/50">
                  <HStack className="w-full justify-between ">
                    <span>Unit Cost</span>
                  </HStack>
                </Td>

                {unitCostsByQuantity.map((cost, index) => {
                  return isMade ? (
                    <Td key={index} className="group-hover:bg-muted/50">
                      <VStack spacing={0}>
                        <span>
                          {unitPriceFormatter.format(
                            unitCostsByQuantity[index]
                          )}
                        </span>
                      </VStack>
                    </Td>
                  ) : (
                    <Td key={index} className="group-hover:bg-muted/50">
                      <NumberField
                        value={optimisticUnitCost}
                        formatOptions={{
                          style: "currency",
                          currency: baseCurrency,
                        }}
                        minValue={0}
                        onChange={(value) => {
                          if (Number.isFinite(value) && value !== cost) {
                            onUpdateCost(value);
                          }
                        }}
                      >
                        <NumberInput
                          className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                          isDisabled={!isEditable}
                          size="sm"
                          min={0}
                        />
                      </NumberField>
                    </Td>
                  );
                })}
              </Tr>
            )}
            {isEmployee && (
              <Tr>
                <Td className="border-r border-border">
                  <HStack className="w-full justify-between ">
                    <span className="flex items-center justify-start gap-2">
                      Markup Percent
                      <Tooltip>
                        <TooltipTrigger tabIndex={-1}>
                          <LuInfo className="w-4 h-4" />
                        </TooltipTrigger>
                        <TooltipContent>(Price - Cost) / Cost</TooltipContent>
                      </Tooltip>
                    </span>
                  </HStack>
                </Td>
                {quantities.map((quantity, index) => {
                  const price = editableFields.prices[quantity]?.unitPrice ?? 0;
                  const cost = unitCostsByQuantity[index];

                  const markup = price ? (price - cost) / cost : 0;

                  return (
                    <Td key={quantity.toString()}>
                      <NumberField
                        value={markup}
                        formatOptions={{
                          style: "percent",
                          maximumFractionDigits: 2,
                        }}
                        onChange={(value) => {
                          if (Number.isFinite(value) && value !== markup) {
                            onUpdatePrice(
                              "unitPrice",
                              quantity,
                              cost * (1 + value)
                            );
                          }
                        }}
                      >
                        <NumberInput
                          className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                          isDisabled={!isEditable}
                          size="sm"
                          min={0}
                        />
                      </NumberField>
                    </Td>
                  );
                })}
              </Tr>
            )}
            <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Unit Price</span>
                </HStack>
              </Td>
              {quantities.map((quantity) => {
                const price = editableFields.prices[quantity]?.unitPrice;
                return (
                  <Td key={quantity.toString()}>
                    <NumberField
                      value={price}
                      formatOptions={{
                        style: "currency",
                        currency: baseCurrency,
                        maximumFractionDigits: unitPricePrecision,
                      }}
                      minValue={0}
                      onChange={(value) => {
                        if (Number.isFinite(value) && value !== price) {
                          onUpdatePrice("unitPrice", quantity, value);
                        }
                      }}
                    >
                      <NumberInput
                        className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                        isDisabled={!isEditable}
                        size="sm"
                        min={0}
                      />
                    </NumberField>
                  </Td>
                );
              })}
            </Tr>

            <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Discount Percent</span>
                </HStack>
              </Td>
              {quantities.map((quantity, index) => {
                const discount =
                  editableFields.prices[quantity]?.discountPercent;

                return (
                  <Td key={index}>
                    <NumberField
                      value={discount}
                      formatOptions={{
                        style: "percent",
                        maximumFractionDigits: 2,
                      }}
                      minValue={0}
                      maxValue={1}
                      onChange={(value) => {
                        if (Number.isFinite(value) && value !== discount) {
                          onUpdatePrice("discountPercent", quantity, value);
                        }
                      }}
                    >
                      <NumberInput
                        className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                        isDisabled={!isEditable}
                        size="sm"
                      />
                    </NumberField>
                  </Td>
                );
              })}
            </Tr>
            <Tr className="[&>td]:bg-muted/60">
              <Td className="border-r border-border group-hover:bg-muted/50">
                <HStack className="w-full justify-between ">
                  <span>Net Unit Price</span>
                </HStack>
              </Td>
              {netPricesByQuantity.map((price, index) => {
                return (
                  <Td key={index} className="group-hover:bg-muted/50">
                    <VStack spacing={0}>
                      <span>{unitPriceFormatter.format(price)}</span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>

            {isEmployee && (
              <Tr className="[&>td]:bg-muted/60">
                <Td className="border-r border-border group-hover:bg-muted/50">
                  <HStack className="w-full justify-between ">
                    <span className="flex items-center justify-start gap-2">
                      Profit Percent
                      <Tooltip>
                        <TooltipTrigger tabIndex={-1}>
                          <LuInfo className="w-4 h-4" />
                        </TooltipTrigger>
                        <TooltipContent>(Price - Cost) / Price</TooltipContent>
                      </Tooltip>
                    </span>
                  </HStack>
                </Td>
                {netPricesByQuantity.map((price, index) => {
                  const cost = unitCostsByQuantity[index];
                  const profit = ((price - cost) / price) * 100;
                  return (
                    <Td key={index} className="group-hover:bg-muted/50">
                      <VStack spacing={0}>
                        {Number.isFinite(profit) ? (
                          <span
                            className={cn(profit < -0.01 && "text-red-500")}
                          >
                            {profit.toFixed(2)}%
                          </span>
                        ) : (
                          <span>-</span>
                        )}
                      </VStack>
                    </Td>
                  );
                })}
              </Tr>
            )}
            {isEmployee && (
              <Tr className="[&>td]:bg-muted/60">
                <Td className="border-r border-border group-hover:bg-muted/50">
                  <HStack className="w-full justify-between ">
                    <span>Total Profit</span>
                  </HStack>
                </Td>
                {quantities.map((quantity, index) => {
                  const price = netPricesByQuantity[index];
                  const cost = unitCostsByQuantity[index];
                  const profit = (price - cost) * quantity;
                  return (
                    <Td key={index} className="group-hover:bg-muted/50">
                      <VStack spacing={0}>
                        {price ? (
                          <span
                            className={cn(profit < -0.01 && "text-red-500")}
                          >
                            {formatter.format(profit)}
                          </span>
                        ) : (
                          <span>-</span>
                        )}
                      </VStack>
                    </Td>
                  );
                })}
              </Tr>
            )}
            <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Shipping Cost</span>
                </HStack>
              </Td>
              {quantities.map((quantity) => {
                const shippingCost =
                  editableFields.prices[quantity]?.shippingCost;
                return (
                  <Td key={quantity.toString()}>
                    <NumberField
                      value={shippingCost}
                      formatOptions={{
                        style: "currency",
                        currency: baseCurrency,
                      }}
                      minValue={0}
                      onChange={(value) => {
                        if (Number.isFinite(value) && value !== shippingCost) {
                          onUpdatePrice("shippingCost", quantity, value);
                        }
                      }}
                    >
                      <NumberInput
                        className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                        isDisabled={!isEditable}
                        size="sm"
                        min={0}
                      />
                    </NumberField>
                  </Td>
                );
              })}
            </Tr>
            {Object.entries(additionalCharges)
              .sort((a, b) => {
                return a[1].description.localeCompare(b[1].description);
              })
              .map(([chargeId, charge]) => {
                const isDeleting =
                  fetcher.state === "loading" &&
                  fetcher.formAction ===
                    path.to.deleteQuoteLineCost(quoteId, lineId) &&
                  fetcher.formData?.get("id") === chargeId;
                return (
                  <Tr key={chargeId}>
                    <Td className="border-r border-border">
                      <HStack className="w-full justify-between ">
                        <Input
                          defaultValue={charge.description}
                          size="sm"
                          className="border-0 -ml-3 shadow-none"
                          onBlur={(e) => {
                            if (
                              e.target.value &&
                              e.target.value !== charge.description
                            ) {
                              onUpdateChargeDescription(
                                chargeId,
                                e.target.value
                              );
                            }
                          }}
                        />
                        <HStack spacing={1}>
                          <fetcher.Form
                            method="post"
                            action={path.to.deleteQuoteLineCost(
                              quoteId,
                              lineId
                            )}
                          >
                            <input type="hidden" name="id" value={chargeId} />
                            <input
                              type="hidden"
                              name="additionalCharges"
                              value={JSON.stringify(additionalCharges ?? {})}
                            />
                            <Button
                              type="submit"
                              aria-label="Delete"
                              size="sm"
                              variant="secondary"
                              isDisabled={
                                !permissions.can("update", "sales") ||
                                isDeleting
                              }
                              isLoading={isDeleting}
                            >
                              <LuTrash className="w-3 h-3" />
                            </Button>
                          </fetcher.Form>
                        </HStack>
                      </HStack>
                    </Td>
                    {quantities.map((quantity) => {
                      const amount = charge.amounts?.[quantity] ?? 0;
                      return (
                        <Td key={quantity.toString()}>
                          <VStack spacing={0}>
                            <NumberField
                              defaultValue={amount}
                              formatOptions={{
                                style: "currency",
                                currency: baseCurrency,
                              }}
                              onChange={(value) => {
                                if (
                                  Number.isFinite(value) &&
                                  value !== amount
                                ) {
                                  onUpdateChargeAmount(
                                    chargeId,
                                    quantity,
                                    value
                                  );
                                }
                              }}
                            >
                              <NumberInput
                                className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                                size="sm"
                                isDisabled={!isEditable}
                                min={0}
                              />
                            </NumberField>
                          </VStack>
                        </Td>
                      );
                    })}
                  </Tr>
                );
              })}
            <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <fetcher.Form
                    method="post"
                    action={path.to.newQuoteLineCost(quoteId, lineId)}
                  >
                    <input
                      type="hidden"
                      name="additionalCharges"
                      value={JSON.stringify(additionalCharges ?? {})}
                    />
                    <Button
                      className="-ml-3"
                      type="submit"
                      rightIcon={<LuCirclePlus />}
                      variant="ghost"
                      isLoading={
                        fetcher.formAction ===
                          path.to.newQuoteLineCost(quoteId, lineId) &&
                        fetcher.state === "loading"
                      }
                      isDisabled={
                        !isEditable ||
                        (fetcher.formAction ===
                          path.to.newQuoteLineCost(quoteId, lineId) &&
                          fetcher.state === "loading")
                      }
                    >
                      Add
                    </Button>
                  </fetcher.Form>
                </HStack>
              </Td>
              {quantities.map((quantity) => {
                return <Td key={quantity.toString()}></Td>;
              })}
            </Tr>
            <Tr className="[&>td]:bg-muted/60">
              <Td className="border-r border-border group-hover:bg-muted/50">
                <HStack className="w-full justify-between ">
                  <span>Subtotal</span>
                </HStack>
              </Td>
              {quantities.map((quantity, index) => {
                const price =
                  (netPricesByQuantity[index] ?? 0) * quantity +
                  (editableFields.prices[quantity]?.shippingCost ?? 0) +
                  (additionalChargesByQuantity[index] ?? 0);
                return (
                  <Td key={index} className="group-hover:bg-muted/50">
                    <VStack spacing={0}>
                      <span>{formatter.format(price)}</span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr className="[&>td]:bg-muted/60">
              <Td className="border-r border-border group-hover:bg-muted/50">
                <HStack className="w-full justify-between ">
                  <span>Tax Percent</span>
                </HStack>
              </Td>
              {quantities.map((quantity, index) => {
                const taxPercent = editableFields.taxPercent;
                return (
                  <Td key={index} className="group-hover:bg-muted/50">
                    <NumberField
                      value={taxPercent}
                      formatOptions={{
                        style: "percent",
                        maximumFractionDigits: 2,
                      }}
                      onChange={(value) => {
                        if (Number.isFinite(value) && value !== taxPercent) {
                          setEditableFields((prev) => ({
                            ...prev,
                            taxPercent: value,
                          }));

                          // Use the quote line update endpoint for tax percent
                          submitFieldUpdates(
                            path.to.quoteLine(quoteId, lineId),
                            {
                              taxPercent: value,
                            }
                          );
                        }
                      }}
                    >
                      <NumberInput
                        className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                        isDisabled={!isEditable}
                        size="sm"
                      />
                    </NumberField>
                  </Td>
                );
              })}
            </Tr>
            <Tr className="font-bold [&>td]:bg-muted/60">
              <Td className="border-r border-border group-hover:bg-muted/50">
                <HStack className="w-full justify-between ">
                  <span>Total Price</span>
                </HStack>
              </Td>
              {quantities.map((quantity, index) => {
                const subtotal =
                  (netPricesByQuantity[index] ?? 0) * quantity +
                  (editableFields.prices[quantity]?.shippingCost ?? 0) +
                  (additionalChargesByQuantity[index] ?? 0);
                const tax = subtotal * editableFields.taxPercent;
                const price = subtotal + tax;
                return (
                  <Td key={index} className="group-hover:bg-muted/50">
                    <VStack spacing={0}>
                      <span>{formatter.format(price)}</span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            {routeData?.quote?.currencyCode !== baseCurrency && (
              <>
                <Tr className="[&>td]:bg-muted/60">
                  <Td className="border-r border-border group-hover:bg-muted/50">
                    <HStack className="w-full justify-between ">
                      <span>Exchange Rate</span>
                    </HStack>
                  </Td>
                  {quantities.map((quantity, index) => {
                    const exchangeRate =
                      editableFields.prices[quantity]?.exchangeRate;
                    return (
                      <Td key={index} className="group-hover:bg-muted/50">
                        <VStack spacing={0}>
                          <span>{exchangeRate ?? 1}</span>
                        </VStack>
                      </Td>
                    );
                  })}
                </Tr>
                <Tr className="font-bold [&>td]:bg-muted/60">
                  <Td className="border-r border-border group-hover:bg-muted/50">
                    <HStack className="w-full justify-between ">
                      <span>Converted Total Price</span>
                    </HStack>
                  </Td>
                  {quantities.map((quantity, index) => {
                    const subtotal =
                      (netPricesByQuantity[index] ?? 0) * quantity +
                      (editableFields.prices[quantity]?.shippingCost ?? 0) +
                      (additionalChargesByQuantity[index] ?? 0);
                    const tax = subtotal * editableFields.taxPercent;
                    const price = subtotal + tax;
                    const exchangeRate =
                      editableFields.prices[quantity]?.exchangeRate;
                    const convertedPrice = price * (exchangeRate ?? 1);
                    return (
                      <Td key={index} className="group-hover:bg-muted/50">
                        <VStack spacing={0}>
                          <span>
                            {presentationCurrencyFormatter.format(
                              convertedPrice
                            )}
                          </span>
                        </VStack>
                      </Td>
                    );
                  })}
                </Tr>
              </>
            )}
          </Tbody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default QuoteLinePricing;
