import { useCarbon } from "@carbon/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import EditableNumberCell from "~/components/EditableNumberCell";
import { Enumerable } from "~/components/Enumerable";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import {
  useCurrencyFormatter,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import { path } from "~/utils/path";
import type {
  SupplierQuote,
  SupplierQuoteLine,
  SupplierQuoteLinePrice
} from "../../types";

const SupplierQuoteLinePricing = ({
  line,
  pricesByQuantity,
  exchangeRate = 1
}: {
  line: SupplierQuoteLine;
  pricesByQuantity: Record<number, SupplierQuoteLinePrice>;
  exchangeRate?: number;
}) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const quantities = line.quantity ?? [1];

  const { id, lineId } = useParams();
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  // Consolidated state for all editable fields
  const [editableFields, setEditableFields] = useState({
    prices: pricesByQuantity
  });

  useEffect(() => {
    setEditableFields((prev) => ({
      ...prev,
      prices: pricesByQuantity
    }));
  }, [pricesByQuantity]);

  const routeData = useRouteData<{
    quote: SupplierQuote;
  }>(path.to.supplierQuote(id));
  const isEditable =
    permissions.can("update", "purchasing") &&
    ["Draft"].includes(routeData?.quote?.status ?? "");

  const { carbon } = useCarbon();
  const { id: userId, company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const formatter = useCurrencyFormatter();
  const presentationCurrencyFormatter = useCurrencyFormatter({
    currency: routeData?.quote?.currencyCode ?? baseCurrency
  });

  const onUpdatePrice = useCallback(
    async (
      key:
        | "leadTime"
        | "supplierUnitPrice"
        | "supplierShippingCost"
        | "supplierTaxAmount",
      quantity: number,
      value: number
    ) => {
      const hasPrice = !!editableFields.prices[quantity];

      const oldPrices = { ...editableFields.prices };
      const newPrices = { ...oldPrices };
      if (!hasPrice) {
        newPrices[quantity] = {
          supplierQuoteId: id,
          supplierQuoteLineId: lineId,
          quantity,
          leadTime: 0,
          exchangeRate: exchangeRate ?? 1,
          supplierUnitPrice: 0,
          supplierShippingCost: 0,
          supplierTaxAmount: 0,
          createdBy: userId
        } as unknown as SupplierQuoteLinePrice;
      }
      newPrices[quantity] = { ...newPrices[quantity], [key]: value };

      setEditableFields((prev) => ({
        ...prev,
        prices: newPrices
      }));

      if (hasPrice) {
        const update = await carbon
          ?.from("supplierQuoteLinePrice")
          .update({
            [key]: value,
            supplierQuoteLineId: lineId,
            quantity
          })
          .eq("supplierQuoteLineId", lineId)
          .eq("quantity", quantity);

        if (update?.error) {
          console.error(update.error);
          toast.error(t`Failed to update supplier quote line`);
        }
      } else {
        const insert = await carbon?.from("supplierQuoteLinePrice").insert({
          ...newPrices[quantity],
          supplierQuoteLineId: lineId,
          quantity
        });

        if (insert?.error) {
          console.error(insert.error);
          toast.error(t`Failed to insert supplier quote line`);
        }
      }
    },
    [editableFields.prices, id, lineId, exchangeRate, userId, carbon, t]
  );

  const unitOfMeasures = useUnitOfMeasure();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Prices</Trans>
        </CardTitle>
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
                const leadTime = editableFields.prices[quantity]?.leadTime ?? 0;
                return (
                  <Td
                    key={quantity.toString()}
                    className="group-hover:bg-muted/50"
                  >
                    <EditableNumberCell
                      value={leadTime}
                      formatOptions={{
                        style: "unit",
                        unit: "day",
                        unitDisplay: "long"
                      }}
                      minValue={0}
                      isEditable={isEditable}
                      onChange={(value) =>
                        onUpdatePrice("leadTime", quantity, value)
                      }
                    />
                  </Td>
                );
              })}
            </Tr>

            <Tr>
              <Td className="border-r border-border">
                <HStack className="w-full justify-between ">
                  <span>Supplier Unit Price</span>

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
                const price =
                  editableFields.prices[quantity]?.supplierUnitPrice ?? 0;
                return (
                  <Td key={quantity.toString()}>
                    <EditableNumberCell
                      value={price}
                      formatOptions={{
                        style: "currency",
                        currency: routeData?.quote?.currencyCode ?? baseCurrency
                      }}
                      minValue={0}
                      isEditable={isEditable}
                      onChange={(value) =>
                        onUpdatePrice("supplierUnitPrice", quantity, value)
                      }
                    />
                  </Td>
                );
              })}
            </Tr>

            <Tr className="[&>td]:bg-muted/60">
              <Td className="border-r border-border group-hover:bg-muted/50">
                <HStack className="w-full justify-between ">
                  <span>Unit Price</span>
                  <Enumerable
                    value={
                      unitOfMeasures.find(
                        (uom) => uom.value === line.inventoryUnitOfMeasureCode
                      )?.label ?? null
                    }
                  />
                </HStack>
              </Td>
              {quantities.map((quantity, index) => {
                const price = editableFields.prices[quantity]?.unitPrice ?? 0;
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
                const shippingCost =
                  editableFields.prices[quantity]?.supplierShippingCost ?? 0;
                return (
                  <Td key={quantity.toString()}>
                    <EditableNumberCell
                      value={shippingCost}
                      formatOptions={{
                        style: "currency",
                        currency: routeData?.quote?.currencyCode ?? baseCurrency
                      }}
                      minValue={0}
                      isEditable={isEditable}
                      onChange={(value) =>
                        onUpdatePrice("supplierShippingCost", quantity, value)
                      }
                    />
                  </Td>
                );
              })}
            </Tr>

            <Tr>
              <Td className="border-r border-border group-hover:bg-muted/50">
                <HStack className="w-full justify-between ">
                  <span>Tax Amount</span>
                </HStack>
              </Td>
              {quantities.map((quantity, index) => {
                const taxAmount =
                  editableFields.prices[quantity]?.supplierTaxAmount ?? 0;
                return (
                  <Td key={index} className="group-hover:bg-muted/50">
                    <EditableNumberCell
                      value={taxAmount}
                      formatOptions={{
                        style: "currency",
                        currency: routeData?.quote?.currencyCode ?? baseCurrency
                      }}
                      minValue={0}
                      isEditable={isEditable}
                      onChange={(value) =>
                        onUpdatePrice("supplierTaxAmount", quantity, value)
                      }
                    />
                  </Td>
                );
              })}
            </Tr>
            <Tr className="font-bold [&>td]:bg-muted/60">
              <Td className="border-r border-border group-hover:bg-muted/50">
                <HStack className="w-full justify-between ">
                  <span>Supplier Total Price</span>
                </HStack>
              </Td>
              {quantities.map((quantity, index) => {
                const subtotal =
                  (editableFields.prices[quantity]?.supplierUnitPrice ?? 0) *
                    quantity +
                  (editableFields.prices[quantity]?.supplierShippingCost ?? 0);
                const tax =
                  editableFields.prices[quantity]?.supplierTaxAmount ?? 0;
                const price = subtotal + tax;

                return (
                  <Td key={index} className="group-hover:bg-muted/50">
                    <VStack spacing={0}>
                      <span>{presentationCurrencyFormatter.format(price)}</span>
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
                    const rate =
                      editableFields.prices[quantity]?.exchangeRate ??
                      exchangeRate ??
                      1;
                    return (
                      <Td key={index} className="group-hover:bg-muted/50">
                        <VStack spacing={0}>
                          <span>{rate ?? 1}</span>
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
                    const subtotal =
                      ((editableFields.prices[quantity]?.supplierUnitPrice ??
                        0) *
                        quantity +
                        (editableFields.prices[quantity]
                          ?.supplierShippingCost ?? 0)) /
                      (editableFields.prices[quantity]?.exchangeRate ?? 1);
                    const tax =
                      (editableFields.prices[quantity]?.supplierTaxAmount ??
                        0) /
                      (editableFields.prices[quantity]?.exchangeRate ?? 1);
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
              </>
            )}
          </Tbody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default SupplierQuoteLinePricing;
