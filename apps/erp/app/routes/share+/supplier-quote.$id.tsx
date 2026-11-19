// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { Input, TextArea, ValidatedForm } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { useAction } from "@carbon/query";
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
  TruncatedTooltipText,
  useDisclosure,
  useMode,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { async, groupBy } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { motion } from "motion/react";
import type { Dispatch, SetStateAction } from "react";
import { useRef, useState } from "react";
import {
  LuChevronRight,
  LuCirclePlus,
  LuImage,
  LuPaperclip,
  LuPencil
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { DateTime } from "~/components";
import { externalSupplierQuoteValidator } from "~/modules/purchasing/purchasing.models";
import { recordSupplierQuoteLinkVisit } from "~/modules/purchasing/purchasing.server";
import {
  getItemSupplierFiles,
  getSupplierQuoteByExternalLinkId,
  getSupplierQuoteLinePricesByQuoteId,
  getSupplierQuoteLines,
  signItemFile
} from "~/modules/purchasing/purchasing.service";
import type {
  SupplierQuote,
  SupplierQuoteLine,
  SupplierQuoteLinePrice
} from "~/modules/purchasing/types";
import { shareLinkContext } from "~/modules/service-context.server";
import { getCompany } from "~/modules/settings/settings.service";
import type { Company } from "~/modules/settings/types";
import { getBase64ImageFromSupabase } from "~/modules/shared/shared.service";
import type { action } from "~/routes/api+/purchasing.digital-quote.$id";
import { path } from "~/utils/path";

const logger = getLogger("erp", "share", "supplier-quote");
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

  const ctx = await shareLinkContext(quote.data);
  if (ctx && quote.data.externalLinkId) {
    await recordSupplierQuoteLinkVisit(ctx, {
      externalLinkId: quote.data.externalLinkId
    });
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

  // No companySettings here: the page never reads it, and the row carries
  // internal config (markups, notification groups, printing) that must not
  // reach an unauthenticated supplier.
  const [company, quoteLines, quoteLinePrices] = await Promise.all([
    getCompany(serviceRole, quote.data.companyId),
    getSupplierQuoteLines(serviceRole, quote.data.id),
    getSupplierQuoteLinePricesByQuoteId(serviceRole, quote.data.id)
  ]);

  // The part files the quote was shared with (`sharedFilePaths`, picked when
  // it was sent), as links signed for an hour (a reload signs them again).
  const filesPromise =
    ctx && quote.data.sharedFilePaths.length > 0
      ? getItemSupplierFiles(
          ctx.asSystem.supabase,
          ctx.asSystem.pg,
          quote.data.companyId,
          (quoteLines.data ?? []).flatMap((line) =>
            line.itemId ? [line.itemId] : []
          ),
          quote.data.sharedFilePaths
        )
          .then((files) =>
            async.map(files, async (file) => ({
              itemId: file.itemId,
              filename: file.filename,
              url: await signItemFile(
                ctx.asSystem.supabase,
                quote.data.companyId,
                file,
                3600,
                file.filename
              )
            }))
          )
          // The quote page stays usable when its files can't be read.
          .catch((error) => {
            logger.error("Failed to read a supplier quote's part files", {
              supplierQuoteId: quote.data.id,
              error
            });
            return [];
          })
      : Promise.resolve([]);

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

  // A picked file that can't be signed stays, shown as unavailable.
  const filesByItem = groupBy(await filesPromise, (file) => file.itemId);

  return {
    state: QuoteState.Valid,
    data: {
      quote: quote.data,
      company: company.data,
      quoteLines:
        quoteLines.data?.map(({ internalNotes, ...line }) => ({
          ...line
        })) ?? [],
      thumbnails: thumbnails,
      files: Object.fromEntries(
        (quoteLines.data ?? []).flatMap((line) =>
          line.id && line.itemId
            ? [[line.id, filesByItem[line.itemId] ?? []]]
            : []
        )
      ),
      quoteLinePrices: quoteLinePrices.data ?? []
    }
  };
}

const LineFiles = ({
  files
}: {
  files: { filename: string; url: string | null }[];
}) => {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {files.map((file) =>
        file.url ? (
          <Button
            key={file.filename}
            variant="secondary"
            leftIcon={<LuPaperclip />}
            asChild
          >
            <a
              href={file.url}
              target="_blank"
              rel="noreferrer"
              download={file.filename}
            >
              {file.filename}
            </a>
          </Button>
        ) : (
          <Button
            key={file.filename}
            variant="secondary"
            leftIcon={<LuPaperclip />}
            isDisabled
          >
            <Trans>{file.filename} (unavailable)</Trans>
          </Button>
        )
      )}
    </div>
  );
};

// rounded icon in badge class name "rounded-full"
const EditableBadge = () => {
  return (
    <Badge variant="green">
      <LuPencil className="w-3 h-3" />
    </Badge>
  );
};

const Header = ({
  company,
  quote,
  locale
}: {
  company: any;
  quote: any;
  locale: string;
}) => (
  <div className="flex justify-between">
    <VStack spacing={4} className="tracking-tight">
      <div>
        <CardTitle className="text-3xl">{company?.name ?? ""}</CardTitle>
        {quote?.supplierQuoteId && (
          <p className="text-lg text-muted-foreground">
            {quote.supplierQuoteId}
          </p>
        )}
        {quote?.expirationDate && (
          <p className="text-lg text-muted-foreground">
            Expires <DateTime value={quote.expirationDate} variant="date" />
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
  </div>
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
  const { t } = useLingui();
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

        <Modal
          open={modal.isOpen}
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
                    label={t`Notes`}
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
  const { t } = useLingui();
  const { quoteLines, thumbnails, files } =
    useLoaderData<typeof loader>().data!;
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

        const isGlAccount = line.supplierQuoteLineType === "G/L Account";
        const lineHeading = isGlAccount
          ? line.description || "Indirect Expense"
          : line.itemReadableId;
        const lineDescription = isGlAccount
          ? "Indirect Expense"
          : line.description;
        const lineName = lineHeading ?? "";

        return (
          <div key={line.id} className="border-b border-input py-6 w-full">
            <HStack spacing={4} className="items-start">
              {thumbnails[line.id] ? (
                <img
                  alt={lineHeading!}
                  className="w-24 h-24 shrink-0 bg-gradient-to-bl from-muted to-muted/40 rounded-lg"
                  src={thumbnails[line.id] ?? undefined}
                />
              ) : (
                <div className="w-24 h-24 shrink-0 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-4">
                  <LuImage className="w-16 h-16 text-muted-foreground" />
                </div>
              )}

              {/* flex-1 + min-w-0, not w-full: `width: 100%` on a flex item
                  resolves against the row's full width and ignores the
                  thumbnail beside it, pushing the description past the card
                  edge. min-w-0 is what lets truncate bite. */}
              <VStack spacing={0} className="flex-1 min-w-0">
                {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: pointer-only shortcut so a click anywhere on the header toggles; the chevron button is the keyboard/AT toggle */}
                <div
                  className="flex flex-col cursor-pointer w-full min-w-0"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a, button")) return;
                    toggleOpen(line.id!);
                  }}
                >
                  <div className="flex items-center gap-x-4 justify-between flex-grow min-w-0">
                    {/* min-w-0 so a long item id wraps inside the card
                        instead of shoving the chevron out of it. */}
                    <Heading className="min-w-0">{lineHeading}</Heading>
                    <HStack spacing={4} className="shrink-0">
                      <motion.button
                        type="button"
                        aria-expanded={openItems.includes(line.id!)}
                        aria-controls={`supplier-quote-line-details-${line.id}`}
                        aria-label={
                          openItems.includes(line.id!)
                            ? t`Hide details for ${lineName}`
                            : t`Show details for ${lineName}`
                        }
                        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => toggleOpen(line.id!)}
                        animate={{
                          rotate: openItems.includes(line.id!) ? 90 : 0
                        }}
                        transition={{ duration: 0.2 }}
                      >
                        <LuChevronRight size={24} aria-hidden />
                      </motion.button>
                    </HStack>
                  </div>
                  <TruncatedTooltipText
                    className="text-muted-foreground text-base truncate"
                    tooltip={lineDescription}
                  >
                    {lineDescription}
                  </TruncatedTooltipText>
                </div>
              </VStack>
            </HStack>

            {/* Stays mounted: LinePricing holds the supplier's unsaved prices.
                `display: none` once collapsed takes it out of the tab order. */}
            <motion.div
              id={`supplier-quote-line-details-${line.id}`}
              initial={false}
              animate={openItems.includes(line.id) ? "open" : "collapsed"}
              variants={{
                open: {
                  opacity: 1,
                  height: "auto",
                  marginTop: 16,
                  display: "block"
                },
                collapsed: {
                  opacity: 0,
                  height: 0,
                  marginTop: 0,
                  transitionEnd: { display: "none" }
                }
              }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="w-full overflow-hidden"
            >
              <LineFiles files={files[line.id] ?? []} />
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
          </div>
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
  const { t } = useLingui();
  const lineLabel =
    line.supplierQuoteLineType === "G/L Account"
      ? line.description || "Indirect Expense"
      : line.itemReadableId;
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
            <Th className="w-[80px]">Unit</Th>
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
                <Td>
                  {line.purchaseUnitOfMeasureCode ??
                    line.inventoryUnitOfMeasureCode}
                </Td>
                {isSelected ? (
                  <>
                    <Td className="">
                      <NumberField
                        aria-label={t`Unit price for ${lineLabel}, quantity ${qty}`}
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
                        aria-label={t`Lead time for ${lineLabel}, quantity ${qty}`}
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
                        aria-label={t`Shipping cost for ${lineLabel}, quantity ${qty}`}
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
                        aria-label={t`Tax for ${lineLabel}, quantity ${qty}`}
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
  const { t } = useLingui();
  const { locale } = useLocale();
  const { id } = useParams();
  if (!id) throw new Error("Could not find external quote id");

  const submitModal = useDisclosure();
  const declineModal = useDisclosure();
  const fetcher = useAction<typeof action>({
    onSettled: () => {
      if (submitted.current) {
        submitModal.onClose();
        declineModal.onClose();
        submitted.current = false;
      }
    }
  });
  const submitted = useRef<boolean>(false);
  const mode = useMode();
  const logo = mode === "dark" ? company?.logoDark : company?.logoLight;

  // Initialize selected lines from existing pricing data
  const [selectedLines, setSelectedLines] = useState<
    Record<string, Record<number, SelectedLine>>
  >(() => {
    const initial: Record<string, Record<number, SelectedLine>> = {};
    for (const price of quoteLinePrices) {
      if (!price.supplierQuoteLineId) continue;
      if (
        (price.supplierUnitPrice && price.supplierUnitPrice > 0) ||
        (price.leadTime && price.leadTime > 0)
      ) {
        if (!initial[price.supplierQuoteLineId]) {
          initial[price.supplierQuoteLineId] = {};
        }
        initial[price.supplierQuoteLineId][price.quantity] = {
          quantity: price.quantity,
          supplierUnitPrice: price.supplierUnitPrice ?? 0,
          unitPrice: price.unitPrice ?? 0,
          leadTime: price.leadTime ?? 0,
          shippingCost: price.shippingCost ?? 0,
          supplierShippingCost: price.supplierShippingCost ?? 0,
          supplierTaxAmount: price.supplierTaxAmount ?? 0
        };
      }
    }
    return initial;
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
        <CardHeader>
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

          <Header company={company} quote={quote} locale={locale} />
        </CardHeader>
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

      <Modal
        open={submitModal.isOpen}
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
                  label={t`Your Name`}
                  placeholder="Enter your name"
                />
                <Input
                  name="digitalSupplierQuoteSubmittedByEmail"
                  label={t`Your Email`}
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

      <Modal
        open={declineModal.isOpen}
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
                  label={t`Reason for declining (Optional)`}
                />
                <Input
                  name="digitalSupplierQuoteSubmittedBy"
                  label={t`Your Name`}
                  placeholder="Enter your name"
                />
                <Input
                  name="digitalSupplierQuoteSubmittedByEmail"
                  label={t`Your Email`}
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
      <h1 className="text-3xl font-semibold">{title}</h1>
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
