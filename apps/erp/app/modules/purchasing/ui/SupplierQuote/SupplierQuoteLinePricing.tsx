import { useCarbon } from "@carbon/auth";
import { getLogger } from "@carbon/logger";
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
import type { TaxPair } from "@carbon/utils";
import {
  INPUT_FORMAT,
  taxableBase,
  taxPairFromAmount,
  taxPairFromPercent
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import EditableNumberCell from "~/components/EditableNumberCell";
import { Enumerable } from "~/components/Enumerable";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import {
  useCurrencyDecimals,
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

const logger = getLogger("erp", "supplierquotelinepricing");

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
    presentationCurrency: { decimalPlaces: number } | null;
  }>(path.to.supplierQuote(id));
  const isEditable =
    permissions.can("update", "purchasing") &&
    ["Draft"].includes(routeData?.quote?.status ?? "");

  const { carbon } = useCarbon();
  const { id: userId, company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  // The loader's currency row first — correct on first paint; the hook covers
  // the case where it isn't loaded, and carries the one documented fallback.
  const quoteCurrency = routeData?.quote?.currencyCode ?? baseCurrency;
  const configuredDecimals = useCurrencyDecimals(quoteCurrency);
  const currencyDecimals =
    routeData?.presentationCurrency?.decimalPlaces ?? configuredDecimals;

  const formatter = useCurrencyFormatter();
  // The inventory-unit price (unitPrice / conversionFactor) is a RATE, not a
  // settlement amount — `formatter` above is also used for an extended total
  // (unitPrice*qty + shipping + tax), so it can't just take rate:true.
  const inventoryPriceFormatter = useCurrencyFormatter({ rate: true });
  const presentationCurrencyFormatter = useCurrencyFormatter({
    currency: quoteCurrency
  });

  /** One writer for every price-break field. The optimistic patch, the
   *  insert-or-update branch and the rollback are identical whichever field
   *  moved, so they live here once; callers say WHAT changed, not how to save
   *  it. */
  const onUpdateFields = useCallback(
    async (quantity: number, patch: Partial<SupplierQuoteLinePrice>) => {
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
          taxPercent: 0,
          createdBy: userId
        } as unknown as SupplierQuoteLinePrice;
      }
      newPrices[quantity] = { ...newPrices[quantity], ...patch };

      setEditableFields((prev) => ({
        ...prev,
        prices: newPrices
      }));

      if (hasPrice) {
        const update = await carbon
          ?.from("supplierQuoteLinePrice")
          .update({
            ...patch,
            supplierQuoteLineId: lineId,
            quantity,
            updatedBy: userId
          })
          .eq("supplierQuoteLineId", lineId)
          .eq("quantity", quantity);

        if (update?.error) {
          logger.error(update.error);
          toast.error(t`Failed to update supplier quote line`);
          setEditableFields((prev) => ({ ...prev, prices: oldPrices }));
        }
      } else {
        const insert = await carbon?.from("supplierQuoteLinePrice").insert({
          ...newPrices[quantity],
          supplierQuoteLineId: lineId,
          quantity
        });

        if (insert?.error) {
          logger.error(insert.error);
          toast.error(t`Failed to insert supplier quote line`);
          setEditableFields((prev) => ({ ...prev, prices: oldPrices }));
        }
      }
    },
    [editableFields.prices, id, lineId, exchangeRate, userId, carbon, t]
  );

  const onUpdatePrice = useCallback(
    (
      key:
        | "leadTime"
        | "supplierUnitPrice"
        | "supplierShippingCost"
        | "supplierTaxAmount",
      quantity: number,
      value: number
    ) => onUpdateFields(quantity, { [key]: value }),
    [onUpdateFields]
  );

  // The tax value pair: any edit writes BOTH the rate and the amount.
  // NOTE: unlike the line forms, editing unit price or shipping here does NOT
  // re-derive the amount for that break. That divergence is deliberate and
  // predates this refactor — closing it is a product decision, not a cleanup.
  const onUpdateTaxPair = useCallback(
    (quantity: number, pair: TaxPair) =>
      onUpdateFields(quantity, {
        taxPercent: pair.percent,
        supplierTaxAmount: pair.amount
      }),
    [onUpdateFields]
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
                      formatOptions={INPUT_FORMAT.rate(
                        quoteCurrency,
                        currencyDecimals
                      )}
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
                        {inventoryPriceFormatter.format(
                          price / (line.conversionFactor ?? 1)
                        )}
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
                      formatOptions={INPUT_FORMAT.money(
                        quoteCurrency,
                        currencyDecimals
                      )}
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
                const price = editableFields.prices[quantity];
                const taxAmount = price?.supplierTaxAmount ?? 0;
                const taxPercent = price?.taxPercent ?? 0;
                const breakSubtotal = taxableBase(
                  price?.supplierUnitPrice ?? 0,
                  quantity,
                  price?.supplierShippingCost ?? 0
                );
                return (
                  <Td key={index} className="group-hover:bg-muted/50">
                    <EditableNumberCell
                      value={taxAmount}
                      formatOptions={INPUT_FORMAT.money(
                        quoteCurrency,
                        currencyDecimals
                      )}
                      minValue={0}
                      isEditable={isEditable}
                      onChange={(value) =>
                        // Two-way: an amount edit restates the rate for this
                        // break, so the stored pair stays consistent
                        onUpdateTaxPair(
                          quantity,
                          taxPairFromAmount(breakSubtotal, value, taxPercent)
                        )
                      }
                    />
                  </Td>
                );
              })}
            </Tr>

            <Tr>
              <Td className="border-r border-border group-hover:bg-muted/50">
                <HStack className="w-full justify-between ">
                  <span>Tax Percent</span>
                </HStack>
              </Td>
              {quantities.map((quantity, index) => {
                const price = editableFields.prices[quantity];
                const taxPercent = price?.taxPercent ?? 0;
                const breakSubtotal = taxableBase(
                  price?.supplierUnitPrice ?? 0,
                  quantity,
                  price?.supplierShippingCost ?? 0
                );
                return (
                  <Td key={index} className="group-hover:bg-muted/50">
                    <EditableNumberCell
                      value={taxPercent}
                      formatOptions={INPUT_FORMAT.percent}
                      minValue={0}
                      maxValue={1}
                      isEditable={isEditable}
                      onChange={(value) =>
                        onUpdateTaxPair(
                          quantity,
                          taxPairFromPercent(
                            breakSubtotal,
                            value,
                            currencyDecimals
                          )
                        )
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
            {quoteCurrency !== baseCurrency && (
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
