import { useCarbon } from "@carbon/auth";
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
  ScrollArea,
  Spinner,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  toast,
  Tr,
  VStack,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Form, useNavigation, useParams } from "@remix-run/react";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useDropzone } from "react-dropzone";
import {
  LuBan,
  LuChevronDown,
  LuCreditCard,
  LuImage,
  LuTrash,
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
import { getDocumentType } from "~/modules/documents";
import { path } from "~/utils/path";
import type {
  Quotation,
  QuotationLine,
  QuotationPayment,
  QuotationPrice,
  QuotationShipment,
} from "../../types";
import { useOpportunityDocuments } from "../OpportunityDocuments/OpportunityDocuments";

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
        addOn: number;
        leadTime: number;
      }
    >
  >({});

  const { carbon } = useCarbon();
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");

  const quoteData = useRouteData<{
    opportunity: { id: string };
  }>(path.to.quote(quoteId));
  const { deleteAttachment, getPath, upload } = useOpportunityDocuments({
    opportunityId: quoteData?.opportunity.id!,
    type: "Quote",
    id: quoteId,
  });
  const [purchaseOrder, setPurchaseOrder] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const onDrop = async (acceptedFiles: File[]) => {
    if (!carbon) {
      toast.error("Carbon client not available");
      return;
    }

    if (purchaseOrder) {
      await removePurchaseOrder();
    }

    if (acceptedFiles.length > 0) {
      flushSync(() => {
        setUploading(true);
      });
      const file = acceptedFiles[0];
      if (file) upload([file]);

      const purchaseOrderDocumentPath = getPath(file);
      const { error } = await carbon
        .from("opportunity")
        .update({
          purchaseOrderDocumentPath,
        })
        .eq("id", quoteData?.opportunity?.id!);

      if (error) {
        console.error("Error updating opportunity:", error);
        toast.error("Failed to update opportunity with purchase order");
      } else {
        setPurchaseOrder(file);
        setStep(1);
      }

      setUploading(false);
    }
  };

  const removePurchaseOrder = async () => {
    if (!carbon) {
      toast.error("Failed to initialize Carbon client");
      return;
    }

    setUploading(true);

    const [opportunityDelete] = await Promise.all([
      carbon
        .from("opportunity")
        .update({
          purchaseOrderDocumentPath: null,
        })
        .eq("id", quoteData?.opportunity.id!),
      // @ts-expect-error
      deleteAttachment(purchaseOrder!),
    ]);

    if (opportunityDelete.error) {
      toast.error("Failed to remove purchase order");
    } else {
      setPurchaseOrder(null);
      toast.success("Purchase order removed successfully");
    }
    setUploading(false);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    disabled: uploading,
  });

  const titles = [
    "Upload Customer Purchase Order",
    "Select Quantities",
    "Confirm Details",
  ];
  const hasPdf = purchaseOrder && getDocumentType(purchaseOrder.name) === "PDF";
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
              {uploading ? (
                <Spinner className="w-8 h-8" />
              ) : purchaseOrder ? (
                <p>{purchaseOrder.name}</p>
              ) : (
                <p>
                  Drag and drop a Purchase Order PDF here, or click to select a
                  file
                </p>
              )}
              <LuUpload className="mx-auto mt-4 h-12 w-12 text-muted-foreground" />
            </div>
            {purchaseOrder ? (
              <Button
                className="w-full"
                leftIcon={<LuTrash />}
                size="lg"
                isDisabled={uploading}
                isLoading={uploading}
                variant="secondary"
                onClick={removePurchaseOrder}
              >
                Remove
              </Button>
            ) : (
              <Button
                className="w-full"
                leftIcon={<LuBan />}
                size="lg"
                variant="secondary"
                onClick={() => setStep(1)}
              >
                Skip
              </Button>
            )}
          </VStack>
        );
      case 1:
        return (
          <HStack className="h-full w-full">
            {hasPdf ? (
              <iframe
                seamless
                title={getPath(purchaseOrder)}
                width="100%"
                height="100%"
                src={path.to.file.previewFile(
                  `private/${getPath(purchaseOrder)}`
                )}
              />
            ) : purchaseOrder &&
              getDocumentType(purchaseOrder.name) === "Image" ? (
              <iframe
                seamless
                title={getPath(purchaseOrder)}
                width="100%"
                height="100%"
                src={path.to.file.previewImage(
                  "private",
                  getPath(purchaseOrder)
                )}
              />
            ) : null}
            <ScrollArea className="h-[calc(100vh-145px)] flex-grow w-full">
              <LinePricingForm
                lines={lines}
                pricing={pricing}
                setSelectedLines={setSelectedLines}
              />
            </ScrollArea>
          </HStack>
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

  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  const isNextButtonDisabled =
    step === 1 && Object.keys(selectedLines).length === 0;

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DrawerContent size={step === 1 ? (hasPdf ? "full" : "xl") : "md"}>
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
            <Button
              onClick={() => setStep(step + 1)}
              isDisabled={isNextButtonDisabled}
            >
              Next
            </Button>
          ) : (
            <Form action={path.to.convertQuoteToOrder(quote.id!)} method="post">
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
          addOn: number;
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
          addOn: number;
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
  const [selectedValue, setSelectedValue] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const [overridePricing, setOverridePricing] = useState({
    quantity: 1,
    leadTime: 0,
    addOn: 0,
    unitPrice: 0,
  });

  useEffect(() => {
    if (selectedValue === "custom") {
      setSelectedLines((prev) => ({
        ...prev,
        [line.id!]: {
          quantity: overridePricing.quantity,
          unitPrice: overridePricing.unitPrice,
          addOn: overridePricing.addOn,
          leadTime: overridePricing.leadTime,
        },
      }));
    }
  }, [line.id, overridePricing, selectedValue, setSelectedLines]);

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
      <RadioGroup
        className="w-full"
        value={selectedValue}
        onValueChange={(value) => {
          const selectedOption =
            value === "custom"
              ? overridePricing
              : options.find((opt) => opt.quantity.toString() === value);

          if (selectedOption) {
            const index =
              value === "custom"
                ? 0
                : options.findIndex((opt) => opt.quantity.toString() === value);
            setSelectedLines((prev) => ({
              ...prev,
              [line.id!]: {
                quantity: selectedOption.quantity,
                unitPrice: selectedOption.unitPrice,
                addOn: additionalChargesByQuantity[index] || 0,
                leadTime: selectedOption.leadTime,
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
                      size="sm"
                      className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                    />
                  </NumberField>
                </Td>
                <Td>
                  <NumberField
                    className="w-[120px]"
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
                    <NumberInput
                      size="sm"
                      className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                    />
                  </NumberField>
                </Td>
                <Td>
                  <NumberField
                    className="w-[120px]"
                    value={overridePricing.addOn}
                    formatOptions={{
                      style: "currency",
                      currency: "USD",
                    }}
                    onChange={(addOn) =>
                      setOverridePricing((v) => ({
                        ...v,
                        addOn,
                      }))
                    }
                  >
                    <NumberInput
                      size="sm"
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
                      size="sm"
                      className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                    />
                  </NumberField>
                </Td>
                <Td>
                  {formatter.format(
                    overridePricing.unitPrice * overridePricing.quantity +
                      overridePricing.addOn
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
  const [isExpanded, setIsExpanded] = useState(true);
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
              <Td className="w-1/2">Bill To</Td>
              <Td>
                <CustomerAvatar
                  customerId={quoteData?.payment.invoiceCustomerId ?? null}
                />
              </Td>
            </Tr>
            <Tr>
              <Td className="w-1/2">Payment Term</Td>
              <Td>
                <Enumerable value={paymentTerm?.label ?? null} />
              </Td>
            </Tr>
          </Tbody>
        </Table>
      )}
    </div>
  );
}

function CustomerDetailsForm() {
  const [isExpanded, setIsExpanded] = useState(true);
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
              <Td className="w-1/2">Customer</Td>
              <Td>
                <CustomerAvatar
                  customerId={quoteData?.quote.customerId ?? null}
                />
              </Td>
            </Tr>
            <Tr>
              <Td className="w-1/2">Customer Ref:</Td>
              <Td>{quoteData?.quote.customerReference}</Td>
            </Tr>
          </Tbody>
        </Table>
      )}
    </div>
  );
}

function ShippingDetailsForm() {
  const [isExpanded, setIsExpanded] = useState(true);
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
              <Td className="w-1/2">Shipping Method</Td>
              <Td className="w-1/2">
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
