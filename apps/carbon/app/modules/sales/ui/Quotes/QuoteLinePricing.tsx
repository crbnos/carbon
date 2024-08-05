import type { Json } from "@carbon/database";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  NumberField,
  NumberInput,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  VStack,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { LuChevronDown, LuInfo, LuRefreshCcw } from "react-icons/lu";
import type { z } from "zod";
import { useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import { path } from "~/utils/path";
import { quoteLineAdditionalChargesValidator } from "../../sales.models";
import type { Costs, QuotationPrice } from "../../types";

const QuoteLinePricing = ({
  quantities,
  additionalCharges: additionalChargesJson,
  pricesByQuantity,
  getLineCosts,
}: {
  quantities: number[];
  additionalCharges?: Json;
  pricesByQuantity: Record<number, QuotationPrice>;
  getLineCosts: (quantity: number) => Costs;
}) => {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");
  const [prices, setPrices] =
    useState<Record<number, QuotationPrice>>(pricesByQuantity);
  useEffect(() => {
    setPrices(pricesByQuantity);
  }, [pricesByQuantity]);

  const { supabase } = useSupabase();
  const fetcher = useFetcher<{ id: string }>();
  const { id: userId } = useUser();

  // TODO: factor in default currency or quote currency
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
    []
  );

  const additionalCharges = useMemo(() => {
    if (fetcher.formAction === path.to.quoteLineCost(quoteId, lineId)) {
      // get the optimistic update
      return JSON.parse(
        (fetcher.formData?.get("additionalCharges") as string) ?? "{}"
      ) as z.infer<typeof quoteLineAdditionalChargesValidator>;
    }
    const parsedAdditionalCharges =
      quoteLineAdditionalChargesValidator.safeParse(additionalChargesJson);

    return parsedAdditionalCharges.success ? parsedAdditionalCharges.data : {};
  }, [
    additionalChargesJson,
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

  const unitCostsByQuantity = quantities.map((quantity, index) => {
    const costs = getLineCosts(quantity);
    const totalCost =
      (costs.materialCost +
        costs.partCost +
        costs.toolCost +
        costs.fixtureCost +
        costs.consumableCost +
        costs.serviceCost +
        costs.laborCost +
        costs.overheadCost +
        costs.outsideCost +
        additionalChargesByQuantity[index]) /
      quantity;
    return totalCost;
  });

  const netPricesByQuantity = quantities.map((quantity, index) => {
    const price = prices[quantity]?.unitPrice ?? 0;
    const discount = prices[quantity]?.discountPercent ?? 0;
    const netPrice = price * (1 - discount / 100);
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

  const onUpdate = async (
    key: "leadTime" | "unitPrice" | "discountPercent",
    quantity: number,
    value: number
  ) => {
    if (!supabase) return;
    const hasPrice = prices[quantity];
    const oldPrices = { ...prices };
    const newPrices = { ...oldPrices };
    if (!hasPrice) {
      newPrices[quantity] = {
        quoteId,
        quoteLineId: lineId,
        quantity,
        leadTime: 0,
        unitPrice: 0,
        discountPercent: 0,
        createdBy: userId,
      } as unknown as QuotationPrice;
    }
    newPrices[quantity] = { ...newPrices[quantity], [key]: value };

    setPrices(newPrices);

    if (hasPrice) {
      const { error } = await supabase
        .from("quoteLinePrice")
        .update({ [key]: value })
        .eq("quoteLineId", lineId)
        .eq("quantity", quantity);
      if (error) {
        setPrices(oldPrices);
      }
    } else {
      const { error } = await supabase.from("quoteLinePrice").insert([
        {
          ...newPrices[quantity],
        },
      ]);
      if (error) {
        setPrices(oldPrices);
      }
    }
  };

  return (
    <Card>
      <HStack className="justify-between">
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
        </CardHeader>
        <CardAction>
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
                  fetcher.state === "loading" &&
                  fetcher.formAction ===
                    path.to.quoteLineRecalculatePrice(quoteId, lineId)
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
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
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
                const leadTime = prices[quantity]?.leadTime ?? 0;
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
                      isDisabled
                      onChange={(value) => {
                        if (Number.isFinite(value) && value !== leadTime) {
                          onUpdate("leadTime", quantity, value);
                        }
                      }}
                    >
                      <NumberInput
                        className="border-0 -ml-3 shadow-none"
                        size="sm"
                        min={0}
                      />
                    </NumberField>
                  </Td>
                );
              })}
            </Tr>
            <Tr className="[&>td]:bg-muted/60">
              <Td className="border-r border-border group-hover:bg-muted/50">
                <HStack className="w-full justify-between ">
                  <span>Unit Cost</span>
                </HStack>
              </Td>
              {unitCostsByQuantity.map((cost, index) => {
                return (
                  <Td key={index} className="group-hover:bg-muted/50">
                    <VStack spacing={0}>
                      <span>{formatter.format(cost ?? 0)}</span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Unit Price</span>
                </HStack>
              </Td>
              {quantities.map((quantity) => {
                const price = prices[quantity]?.unitPrice;
                return (
                  <Td key={quantity.toString()}>
                    <NumberField
                      value={price}
                      formatOptions={{
                        style: "currency",
                        currency: "USD",
                      }}
                      minValue={0}
                      onChange={(value) => {
                        if (Number.isFinite(value) && value !== price) {
                          onUpdate("unitPrice", quantity, value);
                        }
                      }}
                    >
                      <NumberInput
                        className="border-0 -ml-3 shadow-none"
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
                const discount = prices[quantity]?.discountPercent;

                return (
                  <Td key={index}>
                    <NumberField
                      value={discount}
                      formatOptions={{
                        style: "percent",
                        currency: "USD",
                      }}
                      minValue={0}
                      maxValue={1}
                      onChange={(value) => {
                        if (Number.isFinite(value) && value !== discount) {
                          onUpdate("discountPercent", quantity, value);
                        }
                      }}
                    >
                      <NumberInput
                        className="border-0 -ml-3 shadow-none"
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
                  <span>Net Price</span>
                </HStack>
              </Td>
              {netPricesByQuantity.map((price, index) => {
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
                  <span className="flex items-center justify-start gap-2">
                    Markup Percent
                    <Tooltip>
                      <TooltipTrigger>
                        <LuInfo className="w-4 h-4" />
                      </TooltipTrigger>
                      <TooltipContent>(Price - Cost) / Cost</TooltipContent>
                    </Tooltip>
                  </span>
                </HStack>
              </Td>
              {netPricesByQuantity.map((price, index) => {
                const cost = unitCostsByQuantity[index];
                const markup = ((price - cost) / cost) * 100;
                return (
                  <Td key={index} className="group-hover:bg-muted/50">
                    <VStack spacing={0}>
                      {Number.isFinite(markup) ? (
                        <span>{(markup ?? 0).toFixed(2)}%</span>
                      ) : (
                        <span>-</span>
                      )}
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr className="[&>td]:bg-muted/60">
              <Td className="border-r border-border group-hover:bg-muted/50">
                <HStack className="w-full justify-between ">
                  <span className="flex items-center justify-start gap-2">
                    Profit Percent
                    <Tooltip>
                      <TooltipTrigger>
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
                        <span>{profit.toFixed(2)}%</span>
                      ) : (
                        <span>-</span>
                      )}
                    </VStack>
                  </Td>
                );
              })}
            </Tr>

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
                      <span>{formatter.format(profit)}</span>
                    </VStack>
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
                const price = netPricesByQuantity[index];
                return (
                  <Td key={index} className="group-hover:bg-muted/50">
                    <VStack spacing={0}>
                      <span>{formatter.format(price * quantity)}</span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
          </Tbody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default QuoteLinePricing;
