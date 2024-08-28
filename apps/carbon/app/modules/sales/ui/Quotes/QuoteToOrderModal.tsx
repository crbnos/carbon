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
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
} from "@carbon/react";
import { Form } from "@remix-run/react";
import { useMemo, useState } from "react";
import { LuImage } from "react-icons/lu";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import type { Quotation, QuotationLine, QuotationPrice } from "../../types";

type QuoteToOrderDrawerProps = {
  quote: Quotation;
  lines: QuotationLine[];
  pricing: QuotationPrice[];
  onClose: () => void;
};

const QuoteToOrderDrawer = ({
  quote,
  lines,
  pricing,
  onClose,
}: QuoteToOrderDrawerProps) => {
  const pricingByLine = useMemo(
    () =>
      lines.reduce<Record<string, QuotationPrice[]>>((acc, line) => {
        acc[line.id!] = pricing.filter((p) => p.quoteLineId === line.id);
        return acc;
      }, {}),
    [lines, pricing]
  );
  const formatter = useCurrencyFormatter();
  const [selectedLines, setSelectedLines] = useState<
    Record<
      string,
      {
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        leadTime: number;
      }
    >
  >({});

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Form action={path.to.convertQuoteToOrder(quote.id!)} method="post">
        <DrawerContent size="xl">
          <input type="hidden" name="quoteId" value={quote.id!} />
          <input
            type="hidden"
            name="selectedLines"
            value={JSON.stringify(selectedLines)}
          />
          <DrawerHeader>
            <DrawerTitle>Convert to Order</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={8}>
              {lines.map((line) => (
                <VStack key={line.id}>
                  <HStack spacing={2} className="items-start">
                    {line.thumbnailPath ? (
                      <img
                        alt={line.itemReadableId!}
                        className="w-20 h-20 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent"
                        src={`/file/preview/private/${line.thumbnailPath}`}
                      />
                    ) : (
                      <div className="w-20 h-20 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent p-2">
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
                  <LinePricingForm
                    line={line}
                    options={pricingByLine[line.id!]}
                    formatter={formatter}
                  />
                </VStack>
              ))}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button>Convert</Button>
          </DrawerFooter>
        </DrawerContent>
      </Form>
    </Drawer>
  );
};

export default QuoteToOrderDrawer;

type LinePricingFormProps = {
  line: QuotationLine;
  options: QuotationPrice[];
  formatter: Intl.NumberFormat;
};
function LinePricingForm({ line, options, formatter }: LinePricingFormProps) {
  const [showOverride, setShowOverride] = useState(false);
  const [overridePricing, setOverridePricing] = useState({
    quantity: 1,
    leadTime: 0,
    addOns: 0,
    unitPrice: 0,
  });
  const additionalChargesByQuantity =
    line.quantity?.map((quantity) => {
      const charges = Object.values(line.additionalCharges ?? {}).reduce(
        (acc, charge) => {
          const amount = charge.amounts?.[quantity] ?? 0;
          return acc + amount;
        },
        0
      );
      return charges;
    }) ?? [];

  return (
    <VStack spacing={2}>
      <RadioGroup className="w-full">
        <Table>
          <Thead>
            <Tr>
              <Th></Th>
              <Th>Quantity</Th>
              <Th>Unit Price</Th>
              <Th>Add-Ons</Th>
              <Th>Lead Time</Th>
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
              options.map((option, index) => (
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
                  <Td>{formatter.format(option.unitPrice)}</Td>
                  <Td>
                    {formatter.format(additionalChargesByQuantity[index])}
                  </Td>
                  <Td>{option.leadTime} Days</Td>
                  <Td>
                    {formatter.format(
                      option.unitPrice * option.quantity +
                        additionalChargesByQuantity[index]
                    )}
                  </Td>
                </Tr>
              ))
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
                    value={overridePricing.quantity}
                    onChange={(quantity) =>
                      setOverridePricing((v) => ({
                        ...v,
                        quantity,
                      }))
                    }
                  >
                    <NumberInput size="sm" />
                  </NumberField>
                </Td>
                <Td>
                  <NumberField
                    value={overridePricing.unitPrice}
                    formatOptions={{
                      style: "currency",
                      currency: "USD",
                    }}
                    onChange={(unitPrice) =>
                      setOverridePricing((v) => ({
                        ...v,
                        unitPrice,
                      }))
                    }
                  >
                    <NumberInput size="sm" />
                  </NumberField>
                </Td>
                <Td>
                  <NumberField
                    value={overridePricing.addOns}
                    formatOptions={{
                      style: "currency",
                      currency: "USD",
                    }}
                    onChange={(addOns) =>
                      setOverridePricing((v) => ({
                        ...v,
                        addOns,
                      }))
                    }
                  >
                    <NumberInput size="sm" />
                  </NumberField>
                </Td>
                <Td>
                  <NumberField
                    value={overridePricing.leadTime}
                    onChange={(leadTime) =>
                      setOverridePricing((v) => ({
                        ...v,
                        leadTime,
                      }))
                    }
                  >
                    <NumberInput size="sm" />
                  </NumberField>
                </Td>
                <Td>
                  {formatter.format(
                    overridePricing.unitPrice * overridePricing.quantity +
                      overridePricing.addOns
                  )}
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </RadioGroup>
      {!showOverride && (
        <Button variant="secondary" onClick={() => setShowOverride(true)}>
          Add Adjustment
        </Button>
      )}
    </VStack>
  );
}
