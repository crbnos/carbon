import type { Json } from "@carbon/database";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
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
import { useMemo } from "react";
import { LuInfo, LuRefreshCcw } from "react-icons/lu";
import type { z } from "zod";
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

  const fetcher = useFetcher<{ id: string }>();

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
    const price = pricesByQuantity[quantity]?.unitPrice ?? 0;
    const discount = (pricesByQuantity[quantity]?.discountPercent ?? 0) / 100;
    const netPrice = price * (1 - discount / 100);
    return netPrice;
  });

  const onRecalculate = () => {
    const formData = new FormData();
    formData.append("unitCostsByQuantity", JSON.stringify(unitCostsByQuantity));
    formData.append("quantities", JSON.stringify(quantities));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.quoteLineRecaluclatePrice(quoteId, lineId),
    });
  };

  return (
    <Card>
      <HStack className="justify-between">
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
        </CardHeader>
        <CardAction>
          <Button
            variant="secondary"
            leftIcon={<LuRefreshCcw />}
            onClick={onRecalculate}
            isLoading={
              fetcher.state === "loading" &&
              fetcher.formAction ===
                path.to.quoteLineRecaluclatePrice(quoteId, lineId)
            }
            isDisabled={
              fetcher.state === "loading" &&
              fetcher.formAction ===
                path.to.quoteLineRecaluclatePrice(quoteId, lineId)
            }
          >
            Recalculate
          </Button>
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
            <Tr className="[&>td]:bg-muted/80 [&>td]:group-hover:bg-muted/70">
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Unit Cost</span>
                </HStack>
              </Td>
              {unitCostsByQuantity.map((cost, index) => {
                return (
                  <Td key={index}>
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
                const price = pricesByQuantity[quantity]?.unitPrice;
                return (
                  <Td key={quantity.toString()}>
                    <VStack spacing={0}>
                      <span>{formatter.format(price ?? 0)}</span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Lead Time</span>
                </HStack>
              </Td>
              {quantities.map((quantity) => {
                const leadTime = pricesByQuantity[quantity]?.leadTime ?? 0;
                return (
                  <Td key={quantity.toString()}>
                    <VStack spacing={0}>
                      <span>{leadTime} days</span>
                    </VStack>
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
                const discount = pricesByQuantity[quantity]?.discountPercent;

                return (
                  <Td key={index}>
                    <VStack spacing={0}>
                      <span>{(discount ?? 0).toFixed(2)}%</span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr className="[&>td]:bg-muted/80 [&>td]:group-hover:bg-muted/70">
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Net Price</span>
                </HStack>
              </Td>
              {netPricesByQuantity.map((price, index) => {
                return (
                  <Td key={index}>
                    <VStack spacing={0}>
                      <span>{formatter.format(price)}</span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr className="[&>td]:bg-muted/80 [&>td]:group-hover:bg-muted/70">
              <Td className="border-r border-border">
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
                  <Td key={index}>
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
            <Tr className="[&>td]:bg-muted/80 [&>td]:group-hover:bg-muted/70">
              <Td className="border-r border-border">
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
                  <Td key={index}>
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

            <Tr className="[&>td]:bg-muted/80 [&>td]:group-hover:bg-muted/70">
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Total Profit</span>
                </HStack>
              </Td>
              {quantities.map((quantity, index) => {
                const price = netPricesByQuantity[index];
                const cost = unitCostsByQuantity[index];
                const profit = (price - cost) * quantity;
                return (
                  <Td key={index}>
                    <VStack spacing={0}>
                      <span>{formatter.format(profit)}</span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>
            <Tr className="font-bold">
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Total Price</span>
                </HStack>
              </Td>
              {quantities.map((quantity, index) => {
                const price = netPricesByQuantity[index];
                return (
                  <Td key={index}>
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
