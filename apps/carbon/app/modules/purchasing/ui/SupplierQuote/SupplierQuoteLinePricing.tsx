import { useCarbon } from "@carbon/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  NumberField,
  NumberInput,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  toast,
  Tr,
  VStack,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Enumerable } from "~/components/Enumerable";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import {
  useCurrencyFormatter,
  usePermissions,
  useRouteData,
  useUser,
} from "~/hooks";
import { path } from "~/utils/path";
import type {
  SupplierQuote,
  SupplierQuoteLine,
  SupplierQuoteLinePrice,
} from "../../types";

const SupplierQuoteLinePricing = ({
  line,
  pricesByQuantity,
}: {
  line: SupplierQuoteLine;
  pricesByQuantity: Record<number, SupplierQuoteLinePrice>;
}) => {
  const permissions = usePermissions();

  const quantities = line.quantity ?? [1];

  const { id, lineId } = useParams();
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");
  const [prices, setPrices] =
    useState<Record<number, SupplierQuoteLinePrice>>(pricesByQuantity);

  useEffect(() => {
    setPrices(pricesByQuantity);
  }, [pricesByQuantity]);

  const routeData = useRouteData<{
    quote: SupplierQuote;
  }>(path.to.supplierQuote(id));
  const isEditable =
    permissions.can("update", "purchasing") &&
    ["Active"].includes(routeData?.quote?.status ?? "");

  const { carbon } = useCarbon();
  const fetcher = useFetcher<{ id?: string; error: string | null }>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data]);

  const { id: userId, company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const formatter = useCurrencyFormatter();
  const presentationCurrencyFormatter = useCurrencyFormatter(
    routeData?.quote?.currencyCode ?? baseCurrency
  );

  const netPricesByQuantity = quantities.map((quantity, index) => {
    const price = prices[quantity]?.unitPrice ?? 0;
    const discount = prices[quantity]?.discountPercent ?? 0;
    const netPrice = price * (1 - discount);
    return netPrice;
  });

  const onUpdatePrice = async (
    key: "leadTime" | "unitPrice" | "shippingCost",
    quantity: number,
    value: number
  ) => {
    if (!carbon) return;
    const supplierQuoteExchangeRate = await carbon
      .from("supplierQuote")
      .select("id, exchangeRate")
      .eq("id", id)
      .single();

    const hasPrice = prices[quantity];
    const oldPrices = { ...prices };
    const newPrices = { ...oldPrices };
    if (!hasPrice) {
      newPrices[quantity] = {
        supplierQuoteId: id,
        supplierQuoteLineId: lineId,
        quantity,
        leadTime: 0,
        unitPrice: 0,
        discountPercent: 0,
        exchangeRate: supplierQuoteExchangeRate.data?.exchangeRate ?? 1,
        shippingCost: 0,
        createdBy: userId,
      } as unknown as SupplierQuoteLinePrice;
    }
    newPrices[quantity] = { ...newPrices[quantity], [key]: value };

    setPrices(newPrices);

    if (hasPrice) {
      const { error } = await carbon
        .from("supplierQuoteLinePrice")
        .update({ [key]: value })
        .eq("supplierQuoteLineId", lineId)
        .eq("quantity", quantity);
      if (error) {
        setPrices(oldPrices);
      }
    } else {
      const { error } = await carbon.from("supplierQuoteLinePrice").insert([
        {
          ...newPrices[quantity],
        },
      ]);
      if (error) {
        setPrices(oldPrices);
      }
    }
  };

  const unitOfMeasures = useUnitOfMeasure();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prices</CardTitle>
      </CardHeader>

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

            <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Unit Price</span>
                  <Enumerable
                    value={
                      unitOfMeasures.find(
                        (uom) => uom.value === line.purchaseUnitOfMeasureCode
                      )?.label ?? null
                    }
                  />
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
                        currency: baseCurrency,
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

            <Tr className="[&>td]:bg-muted/60">
              <Td className="border-r border-border group-hover:bg-muted/50">
                <HStack className="w-full justify-between ">
                  <span>Net Unit Price</span>
                  <Enumerable
                    value={
                      unitOfMeasures.find(
                        (uom) => uom.value === line.inventoryUnitOfMeasureCode
                      )?.label ?? null
                    }
                  />
                </HStack>
              </Td>
              {netPricesByQuantity.map((price, index) => {
                return (
                  <Td key={index} className="group-hover:bg-muted/50">
                    <VStack spacing={0}>
                      <span>
                        {formatter.format(price / (line.conversionFactor ?? 1))}
                      </span>
                    </VStack>
                  </Td>
                );
              })}
            </Tr>

            <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Shipping Cost</span>
                </HStack>
              </Td>
              {quantities.map((quantity) => {
                const shippingCost = prices[quantity]?.shippingCost;
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

            <Tr className="[&>td]:bg-muted/60">
              <Td className="border-r border-border group-hover:bg-muted/50">
                <HStack className="w-full justify-between ">
                  <span>Tax Percent</span>
                </HStack>
              </Td>
              {quantities.map((quantity, index) => {
                const taxPercent = line.taxPercent ?? 0;
                return (
                  <Td key={index} className="group-hover:bg-muted/50">
                    <NumberField
                      value={taxPercent}
                      formatOptions={{
                        style: "percent",
                        maximumFractionDigits: 2,
                      }}
                    >
                      <NumberInput
                        className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
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
                  (prices[quantity]?.shippingCost ?? 0);
                const tax = subtotal * (line.taxPercent ?? 0);
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
                    const exchangeRate = prices[quantity]?.exchangeRate;
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
                      (prices[quantity]?.shippingCost ?? 0);
                    const tax = subtotal * (line.taxPercent ?? 0);
                    const price = subtotal + tax;
                    const exchangeRate = prices[quantity]?.exchangeRate;
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

export default SupplierQuoteLinePricing;
