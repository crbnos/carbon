import {
  Button,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Heading,
  HStack,
  Label,
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
import { formatDate } from "@carbon/utils";
import { Form, useParams } from "@remix-run/react";
import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  LuBan,
  LuChevronDown,
  LuCreditCard,
  LuImage,
  LuTruck,
  LuUpload,
  LuUserSquare,
} from "react-icons/lu";
import { CustomerAvatar } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePaymentTerm } from "~/components/Form/PaymentTerm";
import { useShippingMethod } from "~/components/Form/ShippingMethod";
import { useRouteData } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import type {
  Quotation,
  QuotationLine,
  QuotationPayment,
  QuotationPrice,
  QuotationShipment,
} from "../../types";

type QuoteToOrderDrawerProps = {
  isOpen: boolean;
  quote: Quotation;
  lines: QuotationLine[];
  pricing: QuotationPrice[];
  onClose: () => void;
};

const QuoteToOrderDrawer = ({
  isOpen,
  quote,
  lines,
  pricing,
  onClose,
}: QuoteToOrderDrawerProps) => {
  const [step, setStep] = useState(0);
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

  const [purchaseOrder, setPurchaseOrder] = useState<File | null>(null);
  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setPurchaseOrder(acceptedFiles[0]);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
  });

  const titles = [
    "Upload Purchase Order",
    "Select Quantities",
    "Confirm Details",
  ];
  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <VStack spacing={4}>
            <div
              {...getRootProps()}
              className={cn(
                "w-full border-2 border-dashed rounded-lg p-8 text-center cursor-pointer",
                isDragActive ? "border-primary" : "border-muted"
              )}
            >
              <input {...getInputProps()} />
              {purchaseOrder ? (
                <p>{purchaseOrder.name}</p>
              ) : (
                <p>
                  Drag and drop a Purchase Order PDF here, or click to select a
                  file
                </p>
              )}
              <LuUpload className="mx-auto mt-4 h-12 w-12 text-muted-foreground" />
            </div>
            <Button
              className="w-full"
              leftIcon={<LuBan />}
              size="lg"
              variant="secondary"
              onClick={() => setStep(1)}
            >
              Skip
            </Button>
          </VStack>
        );
      case 1:
        return (
          <LinePricingForm
            lines={lines}
            pricing={pricing}
            setSelectedLines={setSelectedLines}
          />
        );
      case 2:
        return (
          <VStack spacing={4}>
            <CustomerDetailsForm />
            <PaymentDetailsForm />
            <ShippingDetailsForm />
          </VStack>
        );
      default:
        return null;
    }
  };

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DrawerContent size={step === 1 ? "xl" : "md"}>
        <input type="hidden" name="quoteId" value={quote.id!} />

        <DrawerHeader>
          <DrawerTitle>{titles[step]}</DrawerTitle>
        </DrawerHeader>
        <DrawerBody>{renderStep()}</DrawerBody>
        <DrawerFooter>
          {step > 0 && (
            <Button variant="secondary" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step < 2 ? (
            <Button onClick={() => setStep(step + 1)}>Next</Button>
          ) : (
            <Form action={path.to.convertQuoteToOrder(quote.id!)} method="post">
              <Button type="submit">Convert</Button>
              <input
                type="hidden"
                name="selectedLines"
                value={JSON.stringify(selectedLines)}
              />
            </Form>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export default QuoteToOrderDrawer;

type LinePricingFormProps = {
  lines: QuotationLine[];
  pricing: QuotationPrice[];
  setSelectedLines: Dispatch<
    SetStateAction<
      Record<
        string,
        {
          quantity: number;
          unitPrice: number;
          totalPrice: number;
          leadTime: number;
        }
      >
    >
  >;
};

const LinePricingForm = ({
  lines,
  pricing,
  setSelectedLines,
}: LinePricingFormProps) => {
  const pricingByLine = useMemo(
    () =>
      lines.reduce<Record<string, QuotationPrice[]>>((acc, line) => {
        acc[line.id!] = pricing.filter((p) => p.quoteLineId === line.id);
        return acc;
      }, {}),
    [lines, pricing]
  );
  const formatter = useCurrencyFormatter();

  return (
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
          <LinePricingOptions
            line={line}
            options={pricingByLine[line.id!]}
            formatter={formatter}
            setSelectedLines={setSelectedLines}
          />
        </VStack>
      ))}
    </VStack>
  );
};

type LinePricingOptionsProps = {
  line: QuotationLine;
  options: QuotationPrice[];
  formatter: Intl.NumberFormat;
  setSelectedLines: Dispatch<
    SetStateAction<
      Record<
        string,
        {
          quantity: number;
          unitPrice: number;
          totalPrice: number;
          leadTime: number;
        }
      >
    >
  >;
};

const LinePricingOptions = ({
  line,
  options,
  formatter,
  setSelectedLines,
}: LinePricingOptionsProps) => {
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
                      onChange={() =>
                        setSelectedLines((prev) => ({
                          ...prev,
                          [line.id!]: {
                            quantity: option.quantity,
                            unitPrice: option.unitPrice,
                            totalPrice:
                              option.unitPrice * option.quantity +
                              additionalChargesByQuantity[index],
                            leadTime: option.leadTime,
                          },
                        }))
                      }
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
};

function PaymentDetailsForm() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");

  const quoteData = useRouteData<{
    payment: QuotationPayment;
  }>(path.to.quote(quoteId));

  const paymentTerms = usePaymentTerm();
  const paymentTerm = paymentTerms?.find(
    (pt) => pt.value === quoteData?.payment?.paymentTermId
  );

  return (
    <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4 w-full">
      <HStack
        className="w-full justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <HStack>
          <LuCreditCard />
          <Label>Payment Terms</Label>
        </HStack>
        <LuChevronDown
          className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </HStack>
      {isExpanded && (
        <Table className="py-4">
          <Tbody>
            <Tr>
              <Td>Bill To</Td>
              <Td>
                <CustomerAvatar
                  customerId={quoteData?.payment.invoiceCustomerId ?? null}
                />
              </Td>
            </Tr>
            <Tr>
              <Td>Payment Term</Td>
              <Td>
                <Enumerable value={paymentTerm?.value ?? null} />
              </Td>
            </Tr>
          </Tbody>
        </Table>
      )}
    </div>
  );
}

function CustomerDetailsForm() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");

  const quoteData = useRouteData<{
    quote: Quotation;
  }>(path.to.quote(quoteId));

  return (
    <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4 w-full">
      <HStack
        className="w-full justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <HStack>
          <LuUserSquare />
          <Label>Customer Details</Label>
        </HStack>
        <LuChevronDown
          className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </HStack>
      {isExpanded && (
        <Table className="py-4">
          <Tbody>
            <Tr>
              <Td>Customer</Td>
              <Td>
                <CustomerAvatar
                  customerId={quoteData?.quote.customerId ?? null}
                />
              </Td>
            </Tr>
            <Tr>
              <Td>Customer Ref:</Td>
              <Td>{quoteData?.quote.customerReference}</Td>
            </Tr>
          </Tbody>
        </Table>
      )}
    </div>
  );
}

function ShippingDetailsForm() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");

  const quoteData = useRouteData<{
    shipment: QuotationShipment;
  }>(path.to.quote(quoteId));

  const shippingMethods = useShippingMethod();
  const shippingMethod = shippingMethods?.find(
    (sm) => sm.value === quoteData?.shipment?.shippingMethodId
  );

  return (
    <div className="border border-border rounded-md shadow-sm p-4 flex flex-col gap-4 w-full">
      <HStack
        className="w-full justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <HStack>
          <LuTruck />
          <Label>Shipping</Label>
        </HStack>
        <LuChevronDown
          className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </HStack>
      {isExpanded && (
        <Table className="py-4">
          <Tbody>
            <Tr>
              <Td>Shipping Method</Td>
              <Td>
                <Enumerable value={shippingMethod?.label ?? null} />
              </Td>
            </Tr>
            <Tr>
              <Td>Requested Date</Td>
              <Td>
                {quoteData?.shipment.receiptRequestedDate
                  ? formatDate(quoteData?.shipment?.receiptRequestedDate!)
                  : null}
              </Td>
            </Tr>
          </Tbody>
        </Table>
      )}
    </div>
  );
}
