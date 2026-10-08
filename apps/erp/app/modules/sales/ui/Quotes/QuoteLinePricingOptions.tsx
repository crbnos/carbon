// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  RadioGroup,
  RadioGroupItem,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { useParams } from "react-router";
import { MotionMoney } from "~/components";
import {
  useCurrencyDecimals,
  usePercentFormatter,
  useRouteData
} from "~/hooks";
import { path } from "~/utils/path";
import type {
  Quotation,
  QuotationLine,
  QuotationPrice,
  SalesOrderLine
} from "../../types";

export type SelectedLine = {
  quantity: number;
  netUnitPrice: number;
  convertedNetUnitPrice: number;
  addOn: number;
  convertedAddOn: number;
  taxableAddOn: number;
  convertedTaxableAddOn: number;
  leadTime: number;
  shippingCost: number;
  convertedShippingCost: number;
  taxPercent: number;
  discountPercent: number;
  unitPrice: number;
  convertedUnitPrice: number;
};

export const deselectedLine: SelectedLine = {
  addOn: 0,
  convertedAddOn: 0,
  taxableAddOn: 0,
  convertedTaxableAddOn: 0,
  netUnitPrice: 0,
  convertedNetUnitPrice: 0,
  quantity: 0,
  leadTime: 0,
  shippingCost: 0,
  convertedShippingCost: 0,
  taxPercent: 0,
  discountPercent: 0,
  unitPrice: 0,
  convertedUnitPrice: 0
};

function lineNet(line: SelectedLine) {
  return (line.convertedNetUnitPrice ?? 0) * (line.quantity ?? 0);
}

export function getQuoteLineSubtotal(line: SelectedLine) {
  return (
    lineNet(line) +
    (line.convertedAddOn ?? 0) +
    (line.convertedShippingCost ?? 0)
  );
}

/** Tax applies to the taxable add-ons only, not every add-on. */
export function getQuoteLineTax(line: SelectedLine) {
  return (
    (lineNet(line) +
      (line.convertedTaxableAddOn ?? 0) +
      (line.convertedShippingCost ?? 0)) *
    (line.taxPercent ?? 0)
  );
}

export function getQuoteLineTotal(line: SelectedLine) {
  return getQuoteLineSubtotal(line) + getQuoteLineTax(line);
}

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

export const LinePricingOptions = ({
  line,
  options,
  quoteCurrency,
  shouldConvertCurrency,
  quoteExchangeRate,
  locale,
  formatter,
  selectedLine,
  setSelectedLines
}: LinePricingOptionsProps) => {
  // Settlement money at the document currency's configured decimals.
  const currencyDecimals = useCurrencyDecimals(quoteCurrency);
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

  const taxableAdditionalChargesByQuantity =
    line.quantity?.reduce(
      (acc, quantity) => {
        const charges = Object.values(line.additionalCharges ?? {}).reduce(
          (chargeAcc, charge) => {
            if (charge.taxable === false) return chargeAcc;
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

  const convertedTaxableAdditionalChargesByQuantity = Object.entries(
    taxableAdditionalChargesByQuantity
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
      amount: selectedLine.convertedShippingCost
    });
  }
  Object.entries(line.additionalCharges ?? {}).forEach(([name, charge]) => {
    additionalCharges.push({
      name: charge.description,
      amount: charge.amounts?.[selectedLine.quantity] * quoteExchangeRate
    });
  });

  const hasAnyShipping = options.some(
    (option) => (option.convertedShippingCost ?? 0) > 0
  );
  const hasAnyFees = options.some(
    (option) => (convertedAdditionalChargesByQuantity[option.quantity] ?? 0) > 0
  );

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
                taxableAddOn:
                  taxableAdditionalChargesByQuantity[selectedOption.quantity] ||
                  0,
                convertedTaxableAddOn:
                  convertedTaxableAdditionalChargesByQuantity[
                    selectedOption.quantity
                  ] || 0,
                leadTime: selectedOption.leadTime,
                shippingCost: selectedOption.shippingCost ?? 0,
                convertedShippingCost:
                  selectedOption.convertedShippingCost ?? 0,
                taxPercent: line.taxPercent ?? 0,
                discountPercent: selectedOption.discountPercent ?? 0,
                unitPrice: selectedOption.unitPrice ?? 0,
                convertedUnitPrice: selectedOption.convertedUnitPrice ?? 0
              }
            }));
            setSelectedValue(value);
          }
        }}
      >
        <Table>
          <Thead>
            <Tr>
              <Th />
              <Th>
                <Trans>Quantity</Trans>
              </Th>
              <Th>
                <Trans>Unit Price</Trans>
              </Th>
              <Th>
                <Trans>Discount</Trans>
              </Th>
              {hasAnyShipping && (
                <Th>
                  <Trans>Shipping</Trans>
                </Th>
              )}
              {hasAnyFees && (
                <Th>
                  <Trans>Fees</Trans>
                </Th>
              )}
              <Th>
                <Trans>Lead Time</Trans>
              </Th>
              <Th>
                <Trans>Subtotal</Trans>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {!Array.isArray(options) || options.length === 0 ? (
              <Tr>
                <Td
                  colSpan={5 + (hasAnyShipping ? 1 : 0) + (hasAnyFees ? 1 : 0)}
                  className="text-center py-8"
                >
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
                      {hasAnyShipping && (
                        <Td>
                          {(option.convertedShippingCost ?? 0) > 0
                            ? formatter.format(
                                option.convertedShippingCost ?? 0
                              )
                            : "-"}
                        </Td>
                      )}
                      {hasAnyFees && (
                        <Td>
                          {(convertedAdditionalChargesByQuantity[
                            option.quantity
                          ] ?? 0) > 0
                            ? formatter.format(
                                convertedAdditionalChargesByQuantity[
                                  option.quantity
                                ]
                              )
                            : "-"}
                        </Td>
                      )}
                      <Td>
                        {new Intl.NumberFormat(locale, {
                          style: "unit",
                          unit: "day"
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
                <Td>
                  <Trans>Extended Price</Trans>
                </Td>
                <Td className="text-right">
                  <MotionMoney
                    value={
                      (selectedLine.convertedUnitPrice ?? 0) *
                      selectedLine.quantity
                    }
                    currency={quoteCurrency}
                    decimalPlaces={currencyDecimals}
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
                    <MotionMoney
                      value={
                        (selectedLine.convertedUnitPrice ?? 0) *
                        selectedLine.quantity *
                        selectedLine.discountPercent
                      }
                      currency={quoteCurrency}
                      decimalPlaces={currencyDecimals}
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
                      <MotionMoney
                        value={charge.amount}
                        currency={quoteCurrency}
                        decimalPlaces={currencyDecimals}
                      />
                    </Td>
                  </Tr>
                ))}

              <Tr key="subtotal">
                <Td>
                  <Trans>Subtotal</Trans>
                </Td>
                <Td className="text-right">
                  <MotionMoney
                    value={getQuoteLineSubtotal(selectedLine)}
                    currency={quoteCurrency}
                    decimalPlaces={currencyDecimals}
                  />
                </Td>
              </Tr>

              <Tr key="tax" className="border-b border-border">
                <Td>
                  Tax ({percentFormatter.format(selectedLine.taxPercent)})
                </Td>
                <Td className="text-right">
                  <MotionMoney
                    value={getQuoteLineTax(selectedLine)}
                    currency={quoteCurrency}
                    decimalPlaces={currencyDecimals}
                  />
                </Td>
              </Tr>

              <Tr key="total" className="font-bold">
                <Td>
                  <Trans>Total</Trans>
                </Td>
                <Td className="text-right">
                  <MotionMoney
                    value={getQuoteLineTotal(selectedLine)}
                    currency={quoteCurrency}
                    decimalPlaces={currencyDecimals}
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
