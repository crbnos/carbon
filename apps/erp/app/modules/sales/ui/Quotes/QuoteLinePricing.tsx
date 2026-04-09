import { useCarbon } from "@carbon/auth";
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
  Switch,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  toast,
  VStack
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuCirclePlus,
  LuInfo,
  LuRefreshCcw,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import {
  useCurrencyFormatter,
  usePermissions,
  useRouteData,
  useSettings,
  useUser
} from "~/hooks";
import { path } from "~/utils/path";
import {
  type CostCategoryKey,
  costCategoryKeys,
  quoteLineAdditionalChargesValidator,
  quoteLineCategoryMarkupsValidator
} from "../../sales.models";
import type {
  Costs,
  Quotation,
  QuotationLine,
  QuotationPrice
} from "../../types";

const categoryLabels: Record<CostCategoryKey, string> = {
  materialCost: "Material",
  partCost: "Part",
  toolCost: "Tool",
  consumableCost: "Consumable",
  serviceCost: "Service",
  laborCost: "Labor",
  machineCost: "Machine",
  overheadCost: "Overhead",
  outsideCost: "Outside"
};

const QuoteLinePricing = ({
  line,
  pricesByQuantity,
  exchangeRate,
  getLineCosts
}: {
  line: QuotationLine;
  pricesByQuantity: Record<number, QuotationPrice>;
  exchangeRate: number;
  getLineCosts: (quantity: number) => Costs;
}) => {
  const permissions = usePermissions();

  const hasCalculatedCost = line.methodType !== "Pull from Inventory";
  const quantities = line.quantity ?? [1];

  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  // Consolidated state for all editable fields
  const [editableFields, setEditableFields] = useState({
    prices: pricesByQuantity,
    unitCost: line.unitCost ?? 0,
    additionalCharges: line.additionalCharges || {},
    taxPercent: line.taxPercent ?? 0
  });

  const [showCategoryMarkups, setShowCategoryMarkups] = useState(false);

  useEffect(() => {
    setEditableFields((prev) => ({
      ...prev,
      prices: pricesByQuantity,
      unitCost: line.unitCost ?? 0,
      additionalCharges: line.additionalCharges || {},
      taxPercent: line.taxPercent ?? 0
    }));
  }, [
    pricesByQuantity,
    line.unitCost,
    line.additionalCharges,
    line.taxPercent
  ]);

  const settings = useSettings();
  const defaultCategoryMarkups = useMemo(() => {
    const raw = quoteLineCategoryMarkupsValidator.parse(
      (settings as Record<string, unknown>).quoteLineCategoryMarkups ?? {}
    );
    // Settings stores decimals (0.5 = 50%), but quote line markups use whole numbers (50 = 50%)
    const converted: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
      converted[key] = value * 100;
    }
    return converted;
  }, [settings]);

  const categoryMarkupsByQuantity = useMemo(() => {
    const result: Record<number, Record<string, number>> = {};
    for (const quantity of quantities) {
      const priceMarkups = quoteLineCategoryMarkupsValidator.parse(
        (editableFields.prices[quantity] as Record<string, unknown>)
          ?.categoryMarkups ?? {}
      );
      result[quantity] =
        Object.keys(priceMarkups).length > 0
          ? priceMarkups
          : defaultCategoryMarkups;
    }
    return result;
  }, [editableFields.prices, quantities, defaultCategoryMarkups]);

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

  const { carbon } = useCarbon();
  const { id: userId, company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const formatter = useCurrencyFormatter();
  const unitPriceFormatter = useCurrencyFormatter({
    currency: routeData?.quote?.currencyCode ?? baseCurrency,
    maximumFractionDigits: unitPricePrecision
  });
  const presentationCurrencyFormatter = useCurrencyFormatter({
    currency: routeData?.quote?.currencyCode ?? baseCurrency,
    maximumFractionDigits: unitPricePrecision
  });

  const additionalCharges = useMemo(() => {
    const parsedAdditionalCharges =
      quoteLineAdditionalChargesValidator.safeParse(
        editableFields.additionalCharges
      );

    return parsedAdditionalCharges.success ? parsedAdditionalCharges.data : {};
  }, [editableFields.additionalCharges]);

  const additionalChargesByQuantity = quantities.map((quantity) => {
    const charges = Object.values(additionalCharges).reduce((acc, charge) => {
      const amount = charge.amounts?.[quantity] ?? 0;
      return acc + amount;
    }, 0);
    return charges;
  });

  const taxableAdditionalChargesByQuantity = quantities.map((quantity) => {
    return Object.values(additionalCharges).reduce((acc, charge) => {
      if (charge.taxable === false) return acc;
      return acc + (charge.amounts?.[quantity] ?? 0);
    }, 0);
  });

  const onUpdateChargeDescription = useCallback(
    async (chargeId: string, description: string) => {
      const updatedCharges = {
        ...additionalCharges,
        [chargeId]: {
          ...additionalCharges[chargeId],
          description
        }
      };

      setEditableFields((prev) => {
        return {
          ...prev,
          additionalCharges: updatedCharges
        };
      });

      const costUpdate = await carbon
        ?.from("quoteLine")
        .update({
          additionalCharges: updatedCharges
        })
        .eq("id", lineId);

      if (costUpdate?.error) {
        console.error(costUpdate.error);
        toast.error("Failed to update quote line");
      }
    },
    [additionalCharges, lineId, carbon]
  );

  const onUpdateChargeAmount = useCallback(
    async (chargeId: string, quantity: number, amount: number) => {
      const updatedCharges = {
        ...additionalCharges,
        [chargeId]: {
          ...additionalCharges[chargeId],
          amounts: {
            ...additionalCharges[chargeId].amounts,
            [quantity]: amount
          }
        }
      };

      setEditableFields((prev) => ({
        ...prev,
        additionalCharges: updatedCharges
      }));

      const costUpdate = await carbon
        ?.from("quoteLine")
        .update({
          additionalCharges: updatedCharges
        })
        .eq("id", lineId);

      if (costUpdate?.error) {
        console.error(costUpdate.error);
        toast.error("Failed to update quote line");
      }
    },
    [additionalCharges, carbon, lineId]
  );

  const onUpdateChargeTaxable = useCallback(
    async (chargeId: string, taxable: boolean) => {
      const updatedCharges = {
        ...additionalCharges,
        [chargeId]: {
          ...additionalCharges[chargeId],
          taxable
        }
      };

      setEditableFields((prev) => ({
        ...prev,
        additionalCharges: updatedCharges
      }));

      const costUpdate = await carbon
        ?.from("quoteLine")
        .update({ additionalCharges: updatedCharges })
        .eq("id", lineId);

      if (costUpdate?.error) {
        console.error(costUpdate.error);
        toast.error("Failed to update quote line");
      }
    },
    [additionalCharges, lineId, carbon]
  );

  const costsByQuantity = quantities.map((quantity) => {
    const costs = getLineCosts(quantity);
    return {
      materialCost: costs.materialCost / quantity,
      partCost: costs.partCost / quantity,
      toolCost: costs.toolCost / quantity,
      consumableCost: costs.consumableCost / quantity,
      serviceCost: costs.serviceCost / quantity,
      laborCost: costs.laborCost / quantity,
      machineCost: costs.machineCost / quantity,
      overheadCost: costs.overheadCost / quantity,
      outsideCost: costs.outsideCost / quantity
    };
  });

  const unitCostsByQuantity = hasCalculatedCost
    ? costsByQuantity.map((costs) =>
        Object.values(costs).reduce((sum, v) => sum + v, 0)
      )
    : quantities.map(() => editableFields.unitCost);

  const computeUnitPriceFromMarkups = useCallback(
    (
      categoryCosts: Record<CostCategoryKey, number>,
      markups: Record<string, number>
    ): number => {
      return costCategoryKeys.reduce((sum, key) => {
        const cost = categoryCosts[key] ?? 0;
        const markup = markups[key] ?? 0;
        return sum + cost * (1 + markup / 100);
      }, 0);
    },
    []
  );

  const visibleCategories = costCategoryKeys.filter((key: CostCategoryKey) =>
    costsByQuantity.some((costs) => costs[key] > 0)
  );

  const netPricesByQuantity = quantities.map((quantity, index) => {
    const price = editableFields.prices[quantity]?.unitPrice ?? 0;
    const discount = editableFields.prices[quantity]?.discountPercent ?? 0;
    const netPrice = price * (1 - discount);
    return netPrice;
  });

  const onRecalculate = (markup: number) => {
    const newMarkups: Record<string, number> = {};
    for (const key of costCategoryKeys) {
      newMarkups[key] = markup;
    }

    const newCategoryMarkupsByQuantity: Record<
      string,
      Record<string, number>
    > = {};
    for (const quantity of quantities) {
      newCategoryMarkupsByQuantity[quantity] = newMarkups;
    }

    const unitPricesByQuantity = costsByQuantity.map((costs) =>
      computeUnitPriceFromMarkups(costs, newMarkups)
    );

    const formData = new FormData();
    formData.append(
      "unitPricesByQuantity",
      JSON.stringify(unitPricesByQuantity)
    );
    formData.append("quantities", JSON.stringify(quantities));
    formData.append(
      "categoryMarkupsByQuantity",
      JSON.stringify(newCategoryMarkupsByQuantity)
    );
    fetcher.submit(formData, {
      method: "post",
      action: path.to.quoteLineRecalculatePrice(quoteId, lineId)
    });
  };

  const onUpdatePrecision = (precision: number | string) => {
    const formData = new FormData();
    formData.append("precision", precision.toString());
    fetcher.submit(formData, {
      method: "post",
      action: path.to.quoteLineUpdatePrecision(quoteId, lineId)
    });
  };

  const onUpdateCost = useCallback(
    async (value: number) => {
      if (!line.itemId) return;

      setEditableFields((prev) => ({
        ...prev,
        unitCost: value
      }));

      const costUpdate = await carbon
        ?.from("itemCost")
        .update({
          unitCost: value,
          costIsAdjusted: true,
          updatedAt: today(getLocalTimeZone()).toString()
        })
        .eq("itemId", line.itemId)
        .single();

      if (costUpdate?.error) {
        console.error(costUpdate.error);
        toast.error("Failed to update item cost");
      }
    },
    [carbon, line.itemId]
  );

  const onUpdateCategoryMarkup = useCallback(
    async (category: CostCategoryKey, quantity: number, value: number) => {
      const existingMarkups = categoryMarkupsByQuantity[quantity] ?? {};
      const newMarkups = {
        ...existingMarkups,
        [category]: value
      };

      const quantityIndex = quantities.indexOf(quantity);
      const categoryCosts = costsByQuantity[quantityIndex];
      const unitPrice = computeUnitPriceFromMarkups(categoryCosts, newMarkups);

      setEditableFields((prev) => ({
        ...prev,
        prices: {
          ...prev.prices,
          [quantity]: {
            ...prev.prices[quantity],
            categoryMarkups: newMarkups,
            unitPrice
          }
        }
      }));

      const priceUpdate = await carbon
        ?.from("quoteLinePrice")
        .update({
          categoryMarkups: newMarkups,
          unitPrice
        })
        .eq("quoteLineId", lineId)
        .eq("quantity", quantity);

      if (priceUpdate?.error) {
        console.error(priceUpdate.error);
        toast.error("Failed to update category markups");
      }
    },
    [
      categoryMarkupsByQuantity,
      carbon,
      lineId,
      costsByQuantity,
      quantities,
      computeUnitPriceFromMarkups
    ]
  );

  const onUpdatePrice = useCallback(
    async (
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
          createdBy: userId
        } as unknown as QuotationPrice;
      }
      let roundedValue = value;
      if (key === "unitPrice") {
        // Round the value to the precision of the quote line
        roundedValue = Number(value.toFixed(unitPricePrecision));
      }
      newPrices[quantity] = { ...newPrices[quantity], [key]: roundedValue };

      setEditableFields((prev) => ({
        ...prev,
        prices: newPrices
      }));

      if (hasPrice) {
        const update = await carbon
          ?.from("quoteLinePrice")
          .update({
            [key]: roundedValue,
            quoteLineId: lineId,
            quantity
          })
          .eq("quoteLineId", lineId)
          .eq("quantity", quantity);
        if (update?.error) {
          console.error(update.error);
          toast.error("Failed to update quote line");
        }
      } else {
        const insert = await carbon?.from("quoteLinePrice").insert({
          ...newPrices[quantity],
          quoteLineId: lineId,
          quantity
        });

        if (insert?.error) {
          console.error(insert.error);
          toast.error("Failed to insert quote line");
        }
      }
    },
    [
      line.unitPricePrecision,
      editableFields.prices,
      quoteId,
      lineId,
      exchangeRate,
      userId,
      carbon
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
                    Markup %
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
                        unitDisplay: "long"
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
              <Tr className={cn(hasCalculatedCost && "[&>td]:bg-muted/60")}>
                <Td className="border-r border-border group-hover:bg-muted/50">
                  <HStack className="w-full justify-between ">
                    <span>Unit Cost</span>
                  </HStack>
                </Td>

                {unitCostsByQuantity.map((cost, index) => {
                  return hasCalculatedCost ? (
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
                        value={editableFields.unitCost}
                        formatOptions={{
                          style: "currency",
                          currency: baseCurrency
                        }}
                        minValue={0}
                        onChange={(value) => {
                          if (
                            Number.isFinite(value) &&
                            value !== editableFields.unitCost
                          ) {
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
                          maximumFractionDigits: 2
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
            {isEmployee && hasCalculatedCost && (
              <>
                <Tr>
                  <Td className="border-r border-border">
                    <Button
                      variant="ghost"
                      className="-ml-3"
                      rightIcon={
                        showCategoryMarkups ? (
                          <LuChevronDown />
                        ) : (
                          <LuChevronRight />
                        )
                      }
                      onClick={() =>
                        setShowCategoryMarkups(!showCategoryMarkups)
                      }
                    >
                      Markup by Category
                    </Button>
                  </Td>
                  {quantities.map((quantity) => (
                    <Td key={quantity.toString()} />
                  ))}
                </Tr>
                {showCategoryMarkups &&
                  visibleCategories.map((category: CostCategoryKey) => {
                    return (
                      <Tr key={category}>
                        <Td className="border-r border-border pl-8">
                          <span>{categoryLabels[category]}</span>
                        </Td>
                        {quantities.map((quantity, index) => {
                          const categoryCost =
                            costsByQuantity[index]?.[category] ?? 0;
                          const markupValue =
                            categoryMarkupsByQuantity[quantity]?.[category] ??
                            0;
                          return (
                            <Td key={quantity.toString()}>
                              {categoryCost > 0 ? (
                                <VStack spacing={0}>
                                  <NumberField
                                    value={markupValue / 100}
                                    formatOptions={{
                                      style: "percent",
                                      maximumFractionDigits: 2
                                    }}
                                    minValue={0}
                                    onChange={(value) => {
                                      const percent = value * 100;
                                      if (
                                        Number.isFinite(percent) &&
                                        percent !== markupValue
                                      ) {
                                        onUpdateCategoryMarkup(
                                          category,
                                          quantity,
                                          percent
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
                                  <span className="text-xs text-muted-foreground">
                                    {unitPriceFormatter.format(categoryCost)}
                                  </span>
                                </VStack>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </Td>
                          );
                        })}
                      </Tr>
                    );
                  })}
              </>
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
                        maximumFractionDigits: unitPricePrecision
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
                        maximumFractionDigits: 2
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
                        currency: baseCurrency
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
                        <HStack spacing={1} className="items-center pr-1">
                          <Tooltip>
                            <TooltipTrigger>
                              <Switch
                                variant="small"
                                checked={charge.taxable !== false}
                                disabled={!isEditable}
                                onCheckedChange={(checked) =>
                                  onUpdateChargeTaxable(
                                    chargeId,
                                    checked === true
                                  )
                                }
                              />
                            </TooltipTrigger>
                            <TooltipContent>Taxable</TooltipContent>
                          </Tooltip>
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
                                currency: baseCurrency
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
                        maximumFractionDigits: 2
                      }}
                      onChange={(value) => {
                        if (Number.isFinite(value) && value !== taxPercent) {
                          setEditableFields((prev) => ({
                            ...prev,
                            taxPercent: value
                          }));

                          // TODO: handle mutation
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
                const taxableSubtotal =
                  (netPricesByQuantity[index] ?? 0) * quantity +
                  (editableFields.prices[quantity]?.shippingCost ?? 0) +
                  (taxableAdditionalChargesByQuantity[index] ?? 0);
                const tax = taxableSubtotal * editableFields.taxPercent;
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
                    const taxableSubtotal =
                      (netPricesByQuantity[index] ?? 0) * quantity +
                      (editableFields.prices[quantity]?.shippingCost ?? 0) +
                      (taxableAdditionalChargesByQuantity[index] ?? 0);
                    const tax = taxableSubtotal * editableFields.taxPercent;
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
