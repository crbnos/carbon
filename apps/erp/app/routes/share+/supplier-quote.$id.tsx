import { getCarbonServiceRole } from "@carbon/auth";
import { Input, TextArea, ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  generateHTML,
  Heading,
  HStack,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  NumberField,
  NumberInput,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { useMode } from "@carbon/remix";
import { formatDate } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { motion } from "framer-motion";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import {
  LuChevronRight,
  LuCirclePlus,
  LuImage,
  LuPencil
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useParams } from "react-router";
import { externalSupplierQuoteValidator } from "~/modules/purchasing/purchasing.models";
import {
  getSupplierQuoteByExternalLinkId,
  getSupplierQuoteLinePricesByQuoteId,
  getSupplierQuoteLines
} from "~/modules/purchasing/purchasing.service";
import type {
  SupplierQuote,
  SupplierQuoteLine,
  SupplierQuoteLinePrice
} from "~/modules/purchasing/types";
import type { Company } from "~/modules/settings";
import { getCompany, getCompanySettings } from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";
import type { action } from "~/routes/api+/purchasing.digital-quote.$id";
import { path } from "~/utils/path";

export const meta = () => {
  return [{ title: "Supplier Quote" }];
};

enum QuoteState {
  Valid,
  Expired,
  NotFound
}

type SelectedLine = {
  quantity: number;
  supplierUnitPrice: number;
  unitPrice: number;
  leadTime: number;
  shippingCost: number;
  supplierShippingCost: number;
  supplierTaxAmount: number;
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) {
    return {
      state: QuoteState.NotFound,
      data: null
    };
  }

  const serviceRole = getCarbonServiceRole();
  const quote = await getSupplierQuoteByExternalLinkId(serviceRole, id);

  if (quote.error) {
    return {
      state: QuoteState.NotFound,
      data: null
    };
  }

  // Update lastAccessedAt on externalLink when the page is loaded
  if (quote.data.externalLinkId) {
    await serviceRole
      .from("externalLink")
      .update({
        lastAccessedAt: new Date().toISOString()
      } as any)
      .eq("id", quote.data.externalLinkId);
  }

  if (
    quote.data.expirationDate &&
    new Date(quote.data.expirationDate) < new Date() &&
    quote.data.status === "Draft"
  ) {
    return {
      state: QuoteState.Expired,
      data: null
    };
  }

  const [company, companySettings, quoteLines, quoteLinePrices] =
    await Promise.all([
      getCompany(serviceRole, quote.data.companyId),
      getCompanySettings(serviceRole, quote.data.companyId),
      getSupplierQuoteLines(serviceRole, quote.data.id),
      getSupplierQuoteLinePricesByQuoteId(serviceRole, quote.data.id)
    ]);

  const thumbnailPaths = quoteLines.data?.reduce<Record<string, string | null>>(
    (acc, line) => {
      if (line.thumbnailPath) {
        acc[line.id!] = line.thumbnailPath;
      }
      return acc;
    },
    {}
  );

  const thumbnails: Record<string, string | null> =
    (thumbnailPaths
      ? await Promise.all(
          Object.entries(thumbnailPaths).map(([id, path]) => {
            if (!path) {
              return null;
            }
            return getBase64ImageFromSupabase(serviceRole, path).then(
              (data) => ({
                id,
                data
              })
            );
          })
        )
      : []
    )?.reduce<Record<string, string | null>>((acc, thumbnail) => {
      if (thumbnail) {
        acc[thumbnail.id] = thumbnail.data;
      }
      return acc;
    }, {}) ?? {};

  return {
    state: QuoteState.Valid,
    data: {
      quote: quote.data,
      company: company.data,
      companySettings: companySettings.data,
      quoteLines:
        quoteLines.data?.map(({ internalNotes, ...line }) => ({
          ...line
        })) ?? [],
      thumbnails: thumbnails,
      quoteLinePrices: quoteLinePrices.data ?? []
    }
  };
}

// rounded icon in badge class name "rounded-full"
const EditableBadge = () => {
  return (
    <Badge variant="green">
      <LuPencil className="w-3 h-3" />
    </Badge>
  );
};

const Header = ({ company, quote }: { company: any; quote: any }) => (
  <CardHeader className="flex flex-col sm:flex-row items-start sm:items-start justify-between gap-4 sm:space-y-2 pb-7">
    <VStack spacing={4}>
      <div>
        <CardTitle className="text-3xl">{company?.name ?? ""}</CardTitle>
        {quote?.supplierQuoteId && (
          <p className="text-lg text-muted-foreground">
            {quote.supplierQuoteId}
          </p>
        )}
        {quote?.expirationDate && (
          <p className="text-lg text-muted-foreground">
            Expires {formatDate(quote.expirationDate)}
          </p>
        )}
      </div>

      {quote.status === "Draft" ? (
        <span className="text-base font-semibold foreground">
          Please fill the columns marked with the <EditableBadge /> icon to
          provide pricing
        </span>
      ) : null}
    </VStack>
  </CardHeader>
);

const NotesEditorModal = ({
  notes,
  onSave,
  quoteStatus
}: {
  notes: JSONContent;
  onSave: (content: JSONContent) => void;
  quoteStatus: SupplierQuote["status"];
}) => {
  const isDraft = quoteStatus === "Draft";
  const modal = useDisclosure();

  const [editorContent, setEditorContent] = useState<JSONContent>(notes ?? {});

  const handleEditorChange = (value: JSONContent) => {
    setEditorContent(value);
  };

  const handleSave = () => {
    onSave(editorContent);
    modal.onClose();
  };

  const handleCancel = () => {
    setEditorContent(notes ?? {});
    modal.onClose();
  };

  const hasNotes = notes && Object.keys(notes).length > 0;

  // For non-Draft status, show rendered content (if any)
  if (!isDraft && hasNotes) {
    return (
      <div
        className="prose dark:prose-invert mt-2 text-muted-foreground"
        dangerouslySetInnerHTML={{
          __html: generateHTML(notes)
        }}
      />
    );
  }

  // For Draft status, show button to open modal
  if (isDraft) {
    return (
      <>
        <Button
          className="mt-3"
          leftIcon={hasNotes ? <LuPencil /> : <LuCirclePlus />}
          variant={hasNotes ? "secondary" : "primary"}
          onClick={(e) => {
            e.stopPropagation();
            modal.onOpen();
          }}
        >
          {hasNotes ? "Edit Notes" : "Add Notes"}
        </Button>

        {modal.isOpen && (
          <Modal
            open
            onOpenChange={(open) => {
              if (!open) handleCancel();
            }}
          >
            <ModalOverlay />
            <ModalContent
              className="max-w-4xl"
              onClick={(e) => e.stopPropagation()}
            >
              <ModalHeader>
                <ModalTitle>Edit Notes</ModalTitle>
                <ModalDescription>
                  Add or edit notes for this line item
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <VStack spacing={4} className="w-full">
                  <div className="flex flex-col gap-2 w-full">
                    <Label>Notes</Label>
                    <Editor
                      initialValue={editorContent}
                      onChange={handleEditorChange}
                      className="min-h-[300px] p-4 border rounded-lg transition-colors"
                      disableFileUpload
                    />
                  </div>
                </VStack>
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button onClick={handleSave}>Save Notes</Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}
      </>
    );
  }

  return null;
};

const LineItems = ({
  currencyCode,
  locale,
  selectedLines,
  setSelectedLines,
  quoteStatus,
  quoteLinePrices,
  onSaveNotes
}: {
  currencyCode: string;
  locale: string;
  selectedLines: Record<string, Record<number, SelectedLine>>;
  setSelectedLines: Dispatch<
    SetStateAction<Record<string, Record<number, SelectedLine>>>
  >;
  quoteStatus: SupplierQuote["status"];
  quoteLinePrices: SupplierQuoteLinePrice[];
  onSaveNotes: (lineId: string, content: JSONContent) => void;
}) => {
  const { quoteLines, thumbnails } = useLoaderData<typeof loader>().data!;
  const [openItems, setOpenItems] = useState<string[]>(() =>
    Array.isArray(quoteLines) && quoteLines.length > 0
      ? quoteLines.map((line) => line.id!).filter(Boolean)
      : []
  );

  const toggleOpen = (id: string) => {
    setOpenItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <VStack spacing={8} className="w-full">
      {quoteLines?.map((line) => {
        if (!line.id) return null;

        return (
          <motion.div
            key={line.id}
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="border-b border-input py-6 w-full"
          >
            <HStack spacing={4} className="items-start">
              {thumbnails[line.id] ? (
                <img
                  alt={line.itemReadableId!}
                  className="w-24 h-24 bg-gradient-to-bl from-muted to-muted/40 rounded-lg"
                  src={thumbnails[line.id] ?? undefined}
                />
              ) : (
                <div className="w-24 h-24 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-4">
                  <LuImage className="w-16 h-16 text-muted-foreground" />
                </div>
              )}

              <VStack spacing={0} className="w-full">
                <div
                  className="flex flex-col cursor-pointer w-full"
                  onClick={() => toggleOpen(line.id!)}
                >
                  <div className="flex items-center gap-x-4 justify-between flex-grow">
                    <Heading>{line.itemReadableId}</Heading>
                    <HStack spacing={4}>
                      <motion.div
                        animate={{
                          rotate: openItems.includes(line.id!) ? 90 : 0
                        }}
                        transition={{ duration: 0.3 }}
                      >
                        <LuChevronRight size={24} />
                      </motion.div>
                    </HStack>
                  </div>
                  <span className="text-muted-foreground text-base truncate">
                    {line.description}
                  </span>
                </div>
              </VStack>
            </HStack>

            <motion.div
              initial="collapsed"
              animate={openItems.includes(line.id) ? "open" : "collapsed"}
              variants={{
                open: { opacity: 1, height: "auto", marginTop: 16 },
                collapsed: { opacity: 0, height: 0, marginTop: 0 }
              }}
              transition={{ duration: 0.3 }}
              className="w-full overflow-hidden"
            >
              <LinePricing
                line={line}
                currencyCode={currencyCode}
                locale={locale}
                selectedLines={selectedLines[line.id] || {}}
                setSelectedLines={setSelectedLines}
                quoteStatus={quoteStatus}
                quoteLinePrices={quoteLinePrices}
              />
            </motion.div>
            <NotesEditorModal
              notes={(line.externalNotes as JSONContent) || {}}
              onSave={(content) => onSaveNotes(line.id!, content)}
              quoteStatus={quoteStatus}
            />
          </motion.div>
        );
      })}
    </VStack>
  );
};

const LinePricing = ({
  line,
  currencyCode,
  locale,
  selectedLines,
  setSelectedLines,
  quoteStatus,
  quoteLinePrices
}: {
  line: Omit<SupplierQuoteLine, "internalNotes">;
  currencyCode: string;
  locale: string;
  selectedLines: Record<number, SelectedLine>;
  setSelectedLines: Dispatch<
    SetStateAction<Record<string, Record<number, SelectedLine>>>
  >;
  quoteStatus: SupplierQuote["status"];
  quoteLinePrices: SupplierQuoteLinePrice[];
}) => {
  const pricingOptions =
    quoteLinePrices
      ?.filter((price) => price.supplierQuoteLineId === line.id)
      .sort((a, b) => a.quantity - b.quantity) ?? [];

  // Get quantities from line or use pricing options, always show at least one row
  const quantities =
    Array.isArray(line.quantity) && line.quantity.length > 0
      ? line.quantity
      : pricingOptions.length > 0
        ? pricingOptions.map((opt) => opt.quantity)
        : [1]; // Default to showing at least one row with quantity 1

  const isDisabled = !["Draft"].includes(quoteStatus || "");

  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode
  });

  // Get pricing data for a specific quantity
  const getPricingForQuantity = (qty: number) => {
    return pricingOptions.find((opt) => opt.quantity === qty) ?? null;
  };

  // Store pricing for all quantities, not just selected
  const [pricingByQuantity, setPricingByQuantity] = useState<
    Record<
      number,
      {
        supplierUnitPrice: number;
        leadTime: number;
        supplierShippingCost: number;
        supplierTaxAmount: number;
      }
    >
  >(() => {
    const initial: Record<
      number,
      {
        supplierUnitPrice: number;
        leadTime: number;
        supplierShippingCost: number;
        supplierTaxAmount: number;
      }
    > = {};
    quantities.forEach((qty) => {
      const pricing = getPricingForQuantity(qty);
      initial[qty] = {
        supplierUnitPrice: pricing?.supplierUnitPrice ?? 0,
        leadTime: pricing?.leadTime ?? 0,
        supplierShippingCost: pricing?.supplierShippingCost ?? 0,
        supplierTaxAmount: pricing?.supplierTaxAmount ?? 0
      };
    });
    return initial;
  });

  // Update pricing for a specific quantity
  const updatePricing = (
    quantity: number,
    field:
      | "supplierUnitPrice"
      | "leadTime"
      | "supplierShippingCost"
      | "supplierTaxAmount",
    value: number
  ) => {
    const newValue = isNaN(value) ? 0 : value;

    setPricingByQuantity((prev) => ({
      ...prev,
      [quantity]: {
        ...prev[quantity],
        [field]: newValue
      }
    }));

    // If this quantity is selected, also update the selected line
    setSelectedLines((prev) => {
      const lineSelections = prev[line.id!] || {};
      const current = lineSelections[quantity];

      if (current) {
        return {
          ...prev,
          [line.id!]: {
            ...lineSelections,
            [quantity]: {
              ...current,
              [field]: newValue
            }
          }
        };
      }

      return prev;
    });
  };

  const handleQuantityToggle = (quantity: number, checked: boolean) => {
    if (checked) {
      const storedPricing = pricingByQuantity[quantity];
      const pricing = getPricingForQuantity(quantity);

      setSelectedLines((prev) => ({
        ...prev,
        [line.id!]: {
          ...(prev[line.id!] || {}),
          [quantity]: {
            quantity: quantity,
            supplierUnitPrice:
              storedPricing?.supplierUnitPrice ??
              pricing?.supplierUnitPrice ??
              0,
            unitPrice: pricing?.unitPrice ?? 0,
            leadTime: storedPricing?.leadTime ?? pricing?.leadTime ?? 0,
            shippingCost: pricing?.shippingCost ?? 0,
            supplierShippingCost:
              storedPricing?.supplierShippingCost ??
              pricing?.supplierShippingCost ??
              0,
            supplierTaxAmount:
              storedPricing?.supplierTaxAmount ??
              pricing?.supplierTaxAmount ??
              0
          } as SelectedLine
        }
      }));
    } else {
      setSelectedLines((prev) => {
        const lineSelections = { ...(prev[line.id!] || {}) };
        delete lineSelections[quantity];
        return {
          ...prev,
          [line.id!]: lineSelections
        };
      });
    }
  };

  return (
    <VStack spacing={4}>
      <Table>
        <Thead>
          <Tr className="whitespace-nowrap">
            <Th className="w-[50px]" />
            <Th className="w-2">Quantity</Th>
            <Th className="w-[150px]">
              <HStack spacing={4}>
                <span>Unit Price</span>
                {quoteStatus === "Draft" ? <EditableBadge /> : null}
              </HStack>
            </Th>
            <Th className="w-[120px]">
              <HStack spacing={4}>
                <span>Lead Time</span>
                {quoteStatus === "Draft" ? <EditableBadge /> : null}
              </HStack>
            </Th>
            <Th className="w-[150px]">
              <HStack spacing={4}>
                <span>Shipping Cost</span>
                {quoteStatus === "Draft" ? <EditableBadge /> : null}
              </HStack>
            </Th>
            <Th className="w-[150px]">
              <HStack spacing={4}>
                <span>Tax</span>
                {quoteStatus === "Draft" ? <EditableBadge /> : null}
              </HStack>
            </Th>
            <Th className="w-[100px]">Total</Th>
          </Tr>
        </Thead>
        <Tbody>
          {quantities.map((qty, index) => {
            const storedPricing = pricingByQuantity[qty];
            const pricing = getPricingForQuantity(qty);

            const selectedLine = selectedLines[qty];
            const isSelected = !!selectedLine && selectedLine.quantity === qty;
            const unitPrice =
              storedPricing?.supplierUnitPrice ??
              pricing?.supplierUnitPrice ??
              0;
            const leadTime = storedPricing?.leadTime ?? pricing?.leadTime ?? 0;
            const shippingCost =
              storedPricing?.supplierShippingCost ??
              pricing?.supplierShippingCost ??
              0;
            const taxAmount =
              storedPricing?.supplierTaxAmount ??
              pricing?.supplierTaxAmount ??
              0;
            const total = unitPrice * qty + shippingCost + taxAmount;

            return (
              <Tr key={index}>
                <Td className="w-[50px]">
                  <Checkbox
                    isChecked={isSelected}
                    disabled={isDisabled}
                    onCheckedChange={(checked) => {
                      handleQuantityToggle(qty, !!checked);
                    }}
                    id={`${line.id}:${qty.toString()}`}
                  />
                  <label
                    htmlFor={`${line.id}:${qty.toString()}`}
                    className="sr-only"
                  >
                    {qty}
                  </label>
                </Td>
                <Td>{qty}</Td>
                {isSelected ? (
                  <>
                    <Td className="">
                      <NumberField
                        value={unitPrice}
                        formatOptions={{
                          style: "currency",
                          currency: currencyCode
                        }}
                        isDisabled={isDisabled || !isSelected}
                        minValue={0}
                        onChange={(value) => {
                          if (Number.isFinite(value) && value !== unitPrice) {
                            updatePricing(qty, "supplierUnitPrice", value);
                          }
                        }}
                      >
                        <NumberInput
                          className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                          size="sm"
                          min={0}
                        />
                      </NumberField>
                    </Td>
                    <Td className="w-[150px]">
                      <NumberField
                        value={leadTime}
                        formatOptions={{
                          style: "unit",
                          unit: "day",
                          unitDisplay: "long"
                        }}
                        minValue={0}
                        isDisabled={isDisabled || !isSelected}
                        onChange={(value) => {
                          if (Number.isFinite(value) && value !== leadTime) {
                            updatePricing(qty, "leadTime", value);
                          }
                        }}
                      >
                        <NumberInput
                          className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                          size="sm"
                          min={0}
                        />
                      </NumberField>
                    </Td>
                    <Td className="w-[150px]">
                      <NumberField
                        value={shippingCost}
                        formatOptions={{
                          style: "currency",
                          currency: currencyCode
                        }}
                        isDisabled={isDisabled || !isSelected}
                        minValue={0}
                        onChange={(value) => {
                          if (
                            Number.isFinite(value) &&
                            value !== shippingCost
                          ) {
                            updatePricing(qty, "supplierShippingCost", value);
                          }
                        }}
                      >
                        <NumberInput
                          className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                          size="sm"
                          min={0}
                        />
                      </NumberField>
                    </Td>
                    <Td className="w-[120px]">
                      <NumberField
                        value={taxAmount}
                        formatOptions={{
                          style: "currency",
                          currency: currencyCode
                        }}
                        isDisabled={isDisabled || !isSelected}
                        minValue={0}
                        onChange={(value) => {
                          if (Number.isFinite(value) && value !== taxAmount) {
                            updatePricing(qty, "supplierTaxAmount", value);
                          }
                        }}
                      >
                        <NumberInput
                          className="border-0 -ml-3 shadow-none disabled:bg-transparent disabled:opacity-100"
                          size="sm"
                          min={0}
                        />
                      </NumberField>
                    </Td>
                  </>
                ) : (
                  <Td colSpan={4} className="text-muted-foreground">
                    Select to provide pricing
                  </Td>
                )}
                <Td className="w-[150px]">
                  {isSelected && total > 0 ? formatter.format(total) : "—"}
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </VStack>
  );
};

const Quote = ({
  data
}: {
  data: {
    company: Company;
    quote: SupplierQuote;
    quoteLines: SupplierQuoteLine[];
    quoteLinePrices: SupplierQuoteLinePrice[];
  };
}) => {
  const { company, quote, quoteLinePrices } = data;
  const { locale } = useLocale();
  const { id } = useParams();
  if (!id) throw new Error("Could not find external quote id");

  const submitModal = useDisclosure();
  const declineModal = useDisclosure();
  const fetcher = useFetcher<typeof action>();
  const submitted = useRef<boolean>(false);
  const mode = useMode();
  const logo = mode === "dark" ? company?.logoDark : company?.logoLight;

  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      submitModal.onClose();
      declineModal.onClose();
      submitted.current = false;
    }
  }, [fetcher.state, submitModal, declineModal]);

  // Initialize selected lines - don't select by default
  const [selectedLines, setSelectedLines] = useState<
    Record<string, Record<number, SelectedLine>>
  >(() => {
    return {};
  });

  // Handler to save notes for a line
  const handleSaveNotes = (lineId: string, content: JSONContent) => {
    // Use fetcher to save
    fetcher.submit(
      {
        intent: "updateNotes",
        lineId,
        notes: JSON.stringify(content)
      },
      {
        method: "post",
        action: path.to.api.digitalSupplierQuote(id)
      }
    );
  };

  // Calculate grand total for display (all selected quantities across all lines)
  const eachSelectedLineHasPricingAndLeadTime =
    Object.values(selectedLines).every((lineSelections) => {
      return (
        Object.values(lineSelections).every(
          (line) => line.quantity > 0 && line.leadTime > 0
        ) && Object.values(lineSelections).length > 0
      );
    }) && Object.values(selectedLines).length > 0;

  return (
    <VStack spacing={8} className="w-full items-center p-2 md:p-8">
      {logo && (
        <img
          src={logo}
          alt={company?.name ?? ""}
          className="w-auto mx-auto max-w-5xl"
        />
      )}
      <Card className="w-full max-w-5xl mx-auto">
        <div className="w-full text-center">
          {quote?.status && (quote?.status as string) !== "Draft" && (
            <Status
              className="inline-flex"
              color={quote.status === "Active" ? "green" : "gray"}
            >
              {quote.status}
            </Status>
          )}
        </div>
        <Header company={company} quote={quote} />
        <CardContent>
          <LineItems
            currencyCode={quote.currencyCode ?? "USD"}
            locale={locale}
            selectedLines={selectedLines}
            setSelectedLines={setSelectedLines}
            quoteStatus={quote.status}
            quoteLinePrices={quoteLinePrices}
            onSaveNotes={handleSaveNotes}
          />
          <div className="flex flex-col gap-2">
            {(quote?.status as string) === "Draft" && (
              <VStack className="w-full mt-8 gap-4">
                <Button
                  onClick={submitModal.onOpen}
                  size="lg"
                  variant="primary"
                  isDisabled={!eachSelectedLineHasPricingAndLeadTime}
                  className="w-full text-lg"
                >
                  Submit Quote
                </Button>
                <Button
                  onClick={declineModal.onOpen}
                  size="lg"
                  variant="secondary"
                  className="w-full text-lg"
                >
                  Decline Quote
                </Button>
              </VStack>
            )}
          </div>
        </CardContent>
      </Card>

      {submitModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) submitModal.onClose();
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ValidatedForm
              validator={externalSupplierQuoteValidator}
              action={path.to.api.digitalSupplierQuote(id)}
              method="post"
              fetcher={fetcher}
              onSubmit={() => {
                submitted.current = true;
              }}
            >
              <ModalHeader>
                <ModalTitle>Submit Quote</ModalTitle>
                <ModalDescription>
                  Are you sure you want to submit the updated pricing?
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <input type="hidden" name="intent" value="submit" />
                <input
                  type="hidden"
                  name="selectedLines"
                  value={JSON.stringify(selectedLines)}
                />
                <div className="space-y-4 py-4">
                  <Input
                    name="digitalSupplierQuoteSubmittedBy"
                    label="Your Name"
                    placeholder="Enter your name"
                  />
                  <Input
                    name="digitalSupplierQuoteSubmittedByEmail"
                    label="Your Email"
                    placeholder="Enter your email"
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onClick={submitModal.onClose}>
                  Cancel
                </Button>
                <Button
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                  type="submit"
                >
                  Submit
                </Button>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}

      {declineModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) declineModal.onClose();
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ValidatedForm
              validator={externalSupplierQuoteValidator}
              action={path.to.api.digitalSupplierQuote(id)}
              method="post"
              fetcher={fetcher}
              onSubmit={() => {
                submitted.current = true;
              }}
            >
              <ModalHeader>
                <ModalTitle>Decline Quote</ModalTitle>
                <ModalDescription>
                  Are you sure you want to decline this quote?
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <input type="hidden" name="intent" value="decline" />
                <div className="space-y-4 py-4">
                  <TextArea
                    name="note"
                    label="Reason for declining (Optional)"
                  />
                  <Input
                    name="digitalSupplierQuoteSubmittedBy"
                    label="Your Name"
                    placeholder="Enter your name"
                  />
                  <Input
                    name="digitalSupplierQuoteSubmittedByEmail"
                    label="Your Email"
                    placeholder="Enter your email"
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="ghost" onClick={declineModal.onClose}>
                  Cancel
                </Button>
                <Button
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                  type="submit"
                  variant="destructive"
                >
                  Decline Quote
                </Button>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
    </VStack>
  );
};

export const ErrorMessage = ({
  title,
  message
}: {
  title: string;
  message: string;
}) => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="text-lg text-muted-foreground">{message}</p>
    </div>
  );
};

export default function ExternalSupplierQuote() {
  const { state, data } = useLoaderData<typeof loader>();

  switch (state) {
    case QuoteState.Valid:
      if (data) {
        // TODO: Remove any (gaurav)
        return <Quote data={data as any} />;
      }
      return (
        <ErrorMessage
          title="Quote not found"
          message="Oops! The link you're trying to access is not valid."
        />
      );
    case QuoteState.Expired:
      return (
        <ErrorMessage
          title="Quote expired"
          message="Oops! The link you're trying to access has expired or is no longer valid."
        />
      );
    case QuoteState.NotFound:
      return (
        <ErrorMessage
          title="Quote not found"
          message="Oops! The link you're trying to access is not valid."
        />
      );
  }
}
