import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Heading,
  HStack,
  NumberField,
  NumberInput,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
} from "@carbon/react";
import { Form, useNavigation, useParams } from "@remix-run/react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { LuImage } from "react-icons/lu";
import type { z } from "zod";
import { useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { getPrivateUrl, path } from "~/utils/path";
import type { selectedLineSchema } from "../../purchasing.models";
import type {
  SupplierQuote,
  SupplierQuoteLine,
  SupplierQuoteLinePrice,
} from "../../types";

type SupplierQuoteToOrderDrawerProps = {
  isOpen: boolean;
  quote: SupplierQuote;
  lines: SupplierQuoteLine[];
  pricing: SupplierQuoteLinePrice[];
  onClose: () => void;
};

type SelectedLine = z.infer<typeof selectedLineSchema>;

const SupplierQuoteToOrderDrawer = ({
  isOpen,
  quote,
  lines,
  pricing,
  onClose,
}: SupplierQuoteToOrderDrawerProps) => {
  const [step] = useState(0);
  const [selectedLines, setSelectedLines] = useState<
    Record<string, SelectedLine>
  >({});

  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const titles = ["Select Quantities"];

  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const quoteCurrency = quote.currencyCode ?? baseCurrency;
  const formatter = useCurrencyFormatter({ currency: baseCurrency });
  const presentationCurrencyFormatter = useCurrencyFormatter({
    currency: quoteCurrency,
  });

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <HStack className="h-full w-full">
            <ScrollArea className="h-[calc(100dvh-145px)] flex-grow w-full">
              <LinePricingForm
                quote={quote}
                lines={lines}
                pricing={pricing}
                formatter={formatter}
                presentationCurrencyFormatter={presentationCurrencyFormatter}
                setSelectedLines={setSelectedLines}
              />
            </ScrollArea>
          </HStack>
        );
      default:
        return null;
    }
  };

  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DrawerContent size="full">
        <input type="hidden" name="id" value={quote.id!} />

        <DrawerHeader>
          <DrawerTitle>{titles[step]}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody>{renderStep()}</DrawerBody>
        <DrawerFooter>
          <Form
            action={path.to.convertSupplierQuoteToOrder(quote.id!)}
            method="post"
          >
            <Button
              type="submit"
              isDisabled={isSubmitting}
              isLoading={isSubmitting}
            >
              Convert
            </Button>
            <input
              type="hidden"
              name="selectedLines"
              value={JSON.stringify(selectedLines)}
            />
          </Form>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export default SupplierQuoteToOrderDrawer;

type LinePricingFormProps = {
  quote: SupplierQuote;
  lines: SupplierQuoteLine[];
  pricing: SupplierQuoteLinePrice[];
  formatter: Intl.NumberFormat;
  presentationCurrencyFormatter: Intl.NumberFormat;
  setSelectedLines: Dispatch<SetStateAction<Record<string, SelectedLine>>>;
};

const LinePricingForm = ({
  quote,
  lines,
  pricing,
  formatter,
  presentationCurrencyFormatter,
  setSelectedLines,
}: LinePricingFormProps) => {
  const pricingByLine = useMemo(
    () =>
      lines.reduce<Record<string, SupplierQuoteLinePrice[]>>((acc, line) => {
        acc[line.id!] = pricing.filter(
          (p) => p.supplierQuoteLineId === line.id
        );
        return acc;
      }, {}),
    [lines, pricing]
  );

  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const quoteCurrency = quote.currencyCode ?? baseCurrency;
  const shouldConvertCurrency = quoteCurrency !== baseCurrency;
  const quoteExchangeRate = quote.exchangeRate ?? 1;

  return (
    <VStack spacing={8}>
      {lines.map((line) => (
        <VStack key={line.id}>
          <HStack spacing={2} className="items-start">
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

            <VStack spacing={0}>
              <Heading>{line.itemReadableId}</Heading>
              <span className="text-muted-foreground text-base truncate">
                {line.description}
              </span>
            </VStack>
          </HStack>
          <LinePricingOptions
            line={line}
            options={pricingByLine[line.id!]}
            quoteCurrency={quoteCurrency}
            shouldConvertCurrency={shouldConvertCurrency}
            quoteExchangeRate={quoteExchangeRate}
            formatter={formatter}
            presentationCurrencyFormatter={presentationCurrencyFormatter}
            setSelectedLines={setSelectedLines}
          />
        </VStack>
      ))}
    </VStack>
  );
};

type LinePricingOptionsProps = {
  line: SupplierQuoteLine;
  options: SupplierQuoteLinePrice[];
  quoteCurrency: string;
  shouldConvertCurrency: boolean;
  quoteExchangeRate: number;
  formatter: Intl.NumberFormat;
  presentationCurrencyFormatter: Intl.NumberFormat;
  setSelectedLines: Dispatch<SetStateAction<Record<string, SelectedLine>>>;
};

const LinePricingOptions = ({
  line,
  options,
  quoteCurrency,
  quoteExchangeRate,
  presentationCurrencyFormatter,
  setSelectedLines,
}: LinePricingOptionsProps) => {
  const [selectedValue, setSelectedValue] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const [overridePricing, setOverridePricing] = useState<SelectedLine>({
    quantity: 1,
    leadTime: 0,
    unitPrice: 0,
    supplierUnitPrice: 0,
    supplierShippingCost: 0,
    shippingCost: 0,
    supplierTaxAmount: 0,
  });

  useEffect(() => {
    if (selectedValue === "custom") {
      setSelectedLines((prev) => ({
        ...prev,
        [line.id!]: {
          quantity: overridePricing.quantity,
          unitPrice: overridePricing.unitPrice,
          supplierUnitPrice: overridePricing.supplierUnitPrice,
          supplierShippingCost: overridePricing.supplierShippingCost,
          shippingCost: overridePricing.shippingCost,
          leadTime: overridePricing.leadTime,
          supplierTaxAmount: overridePricing.supplierTaxAmount,
        },
      }));
    }
  }, [
    line.id,
    overridePricing,
    selectedValue,
    setSelectedLines,
    quoteExchangeRate,
  ]);

  return (
    <VStack spacing={2}>
      <RadioGroup
        className="w-full"
        value={selectedValue}
        onValueChange={(value) => {
          const selectedOption =
            value === "custom"
              ? overridePricing
              : options.find((opt) => opt.quantity.toString() === value);

          if (selectedOption) {
            setSelectedLines((prev) => ({
              ...prev,
              [line.id!]: {
                quantity: selectedOption.quantity,
                unitPrice: selectedOption.unitPrice ?? 0,
                supplierUnitPrice: selectedOption.supplierUnitPrice ?? 0,
                supplierShippingCost: selectedOption.supplierShippingCost ?? 0,
                shippingCost: selectedOption.shippingCost ?? 0,
                leadTime: selectedOption.leadTime,
                supplierTaxAmount: selectedOption.supplierTaxAmount ?? 0,
              },
            }));
            setSelectedValue(value);
          }
        }}
      >
        <Table>
          <Thead>
            <Tr>
              <Th></Th>
              <Th>Quantity</Th>
              <Th>Unit Price</Th>
              <Th>Shipping</Th>
              <Th>Lead Time</Th>
              <Th>Tax</Th>
              <Th>Total Price</Th>
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
                  line?.quantity?.includes(option.quantity) && (
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
                        {presentationCurrencyFormatter.format(
                          option.supplierUnitPrice ?? 0
                        )}
                      </Td>
                      <Td>
                        {presentationCurrencyFormatter.format(
                          option.supplierShippingCost ?? 0
                        )}
                      </Td>
                      <Td>{option.leadTime} days</Td>
                      <Td>
                        {presentationCurrencyFormatter.format(
                          option.supplierTaxAmount ?? 0
                        )}
                      </Td>
                      <Td>
                        {presentationCurrencyFormatter.format(
                          (option.supplierUnitPrice ?? 0) * option.quantity +
                            (option.supplierShippingCost ?? 0) +
                            (option.supplierTaxAmount ?? 0)
                        )}
                      </Td>
                    </Tr>
                  )
              )
            )}
            {showOverride && (
              <Tr>
                <Td>
                  <RadioGroupItem value="custom" id={`${line.id}:custom`} />
                  <label
                    htmlFor={`${line.id}:custom`}
                    className="sr-only"
                  ></label>
                </Td>
                <Td>
                  <NumberField
                    className="w-[120px]"
                    value={overridePricing.quantity}
                    onChange={(quantity) =>
                      setOverridePricing((v) => ({
                        ...v,
                        quantity,
                      }))
                    }
                  >
                    <NumberInput
                      size="md"
                      className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                    />
                  </NumberField>
                </Td>
                <Td>
                  <NumberField
                    className="w-[120px]"
                    value={overridePricing.supplierUnitPrice}
                    formatOptions={{
                      style: "currency",
                      currency: quoteCurrency,
                    }}
                    onChange={(unitPrice) =>
                      setOverridePricing((v) => ({
                        ...v,
                        supplierUnitPrice: unitPrice,
                        unitPrice: unitPrice * quoteExchangeRate,
                      }))
                    }
                  >
                    <NumberInput
                      size="md"
                      className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                    />
                  </NumberField>
                </Td>
                <Td>
                  <NumberField
                    className="w-[120px]"
                    value={overridePricing.supplierShippingCost}
                    formatOptions={{
                      style: "currency",
                      currency: quoteCurrency,
                    }}
                    onChange={(shippingCost) =>
                      setOverridePricing((v) => ({
                        ...v,
                        shippingCost: shippingCost * quoteExchangeRate,
                        supplierShippingCost: shippingCost,
                      }))
                    }
                  >
                    <NumberInput
                      size="md"
                      className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                    />
                  </NumberField>
                </Td>

                <Td>
                  <NumberField
                    className="w-[120px]"
                    formatOptions={{
                      style: "unit",
                      unit: "day",
                      unitDisplay: "long",
                    }}
                    value={overridePricing.leadTime}
                    onChange={(leadTime) =>
                      setOverridePricing((v) => ({
                        ...v,
                        leadTime,
                      }))
                    }
                  >
                    <NumberInput
                      size="md"
                      className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                    />
                  </NumberField>
                </Td>
                <Td>
                  <NumberField
                    className="w-[120px]"
                    value={overridePricing.supplierTaxAmount}
                    formatOptions={{
                      style: "currency",
                      currency: quoteCurrency,
                    }}
                    onChange={(taxAmount) =>
                      setOverridePricing((v) => ({
                        ...v,
                        supplierTaxAmount: taxAmount,
                      }))
                    }
                  >
                    <NumberInput
                      size="md"
                      className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                    />
                  </NumberField>
                </Td>
                <Td>
                  {presentationCurrencyFormatter.format(
                    overridePricing.supplierUnitPrice *
                      overridePricing.quantity +
                      overridePricing.supplierShippingCost +
                      overridePricing.supplierTaxAmount
                  )}
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </RadioGroup>
      {!showOverride && (
        <Button
          variant="secondary"
          onClick={() => {
            setShowOverride(true);
            setSelectedValue("custom");
          }}
        >
          Add Adjustment
        </Button>
      )}
    </VStack>
  );
};
