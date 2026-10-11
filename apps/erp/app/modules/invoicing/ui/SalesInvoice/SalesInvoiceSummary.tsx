// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Table,
  Tbody,
  Td,
  Tr,
  TruncatedTooltipText,
  useViewport,
  VStack
} from "@carbon/react";
import { distinctItemText, getItemReadableId } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { motion } from "motion/react";
import { useState } from "react";
import { LuChevronRight, LuImage } from "react-icons/lu";
import { Link, useParams } from "react-router";
import { CustomerAvatar, DateTime, MethodIcon } from "~/components";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { SummaryLineList, SummaryLineRow } from "~/components/SummaryLineRow";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  useRouteData,
  useUser
} from "~/hooks";
import { useItems } from "~/stores";
import { getPrivateUrl, path } from "~/utils/path";
import { isSalesInvoiceLocked } from "../../invoicing.models";
import type {
  SalesInvoice,
  SalesInvoiceLine,
  SalesInvoiceShipment
} from "../../types";
import { useRentalLineTypeLabel } from "./useRentalLineTypeLabel";

const LineItems = ({
  currencyCode,
  presentationCurrencyFormatter,
  formatter,
  locale,
  salesInvoiceLines,
  shouldConvertCurrency
}: {
  currencyCode: string;
  presentationCurrencyFormatter: Intl.NumberFormat;
  formatter: Intl.NumberFormat;
  locale: string;
  salesInvoiceLines: SalesInvoiceLine[];
  shouldConvertCurrency: boolean;
}) => {
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const { isPhone } = useViewport();
  const [items] = useItems();
  const percentFormatter = usePercentFormatter();
  const rentalLineTypeLabel = useRentalLineTypeLabel();
  const [openItems, setOpenItems] = useState<string[]>([]);
  const unitOfMeasures = useUnitOfMeasure();

  const toggleOpen = (id: string) => {
    setOpenItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const rows = salesInvoiceLines.map((line) => {
    if (!line.id) return null;

    const itemReadableId =
      line.invoiceLineType === "Rental"
        ? rentalLineTypeLabel(line.rentalLineType)
        : line.invoiceLineType === "Fixed Asset"
          ? (line as any).assetReadableId || "Fixed Asset"
          : getItemReadableId(items, line.itemId);
    const description = distinctItemText(itemReadableId, line.description);
    // The discount reduces the merchandise only (the generated net
    // prices); add-ons and shipping are not discounted.
    const discountPercent = line.discountPercent ?? 0;
    const discount = percentFormatter.format(discountPercent);
    const lineSubtotal = (line.netUnitPrice ?? 0) * (line.quantity ?? 0);
    const customerSubtotal =
      (line.convertedNetUnitPrice ?? 0) * (line.quantity ?? 0);
    const total =
      (lineSubtotal + (line.addOnCost ?? 0) + (line.shippingCost ?? 0)) *
        (1 + (line.taxPercent ?? 0)) +
      (line.nonTaxableAddOnCost ?? 0);
    const customerTotal =
      (customerSubtotal +
        (line.convertedAddOnCost ?? 0) +
        (line.convertedShippingCost ?? 0)) *
        (1 + (line.taxPercent ?? 0)) +
      (line.convertedNonTaxableAddOnCost ?? 0);

    const lineTaxAmount =
      (line.taxPercent ?? 0) *
      (lineSubtotal + (line.addOnCost ?? 0) + (line.shippingCost ?? 0));

    const customerLineTaxAmount =
      (line.taxPercent ?? 0) *
      (customerSubtotal +
        (line.convertedAddOnCost ?? 0) +
        (line.convertedShippingCost ?? 0));

    // Phones: one row that opens the line page (its Edit link, the
    // badges and the breakdown stay on desktop).
    if (isPhone) {
      return (
        <SummaryLineRow
          key={line.id}
          to={path.to.salesInvoiceLine(invoiceId, line.id)}
          title={itemReadableId}
          value={formatter.format(total)}
          description={description}
          meta={
            <>
              {line.quantity} × {formatter.format(line.unitPrice ?? 0)}{" "}
              {
                unitOfMeasures.find(
                  (uom) => uom.value === line.unitOfMeasureCode
                )?.label
              }
            </>
          }
        />
      );
    }

    return (
      <motion.div
        key={line.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="border-b border-input py-6 w-full"
      >
        <HStack spacing={4} className="items-start">
          {line.thumbnailPath ? (
            <img
              alt={itemReadableId ?? ""}
              className="w-24 h-24 shrink-0 bg-gradient-to-bl from-muted to-muted/40 rounded-lg"
              src={getPrivateUrl(line.thumbnailPath)}
            />
          ) : (
            <div className="w-24 h-24 shrink-0 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-4">
              <LuImage className="w-16 h-16 text-muted-foreground" />
            </div>
          )}

          <VStack spacing={0} className="flex-1 min-w-0">
            <div
              className="flex flex-col cursor-pointer w-full"
              onClick={() => toggleOpen(line.id!)}
            >
              {/* The text column must shrink (flex-1 min-w-0) or a long
                      description shoves the totals out of the card, and its
                      children need w-full because VStack is items-start, which
                      sizes each child to its own content and leaves truncate
                      inert no matter how narrow the column gets. */}
              <div className="flex items-center justify-between w-full">
                <VStack spacing={0} className="flex-1 min-w-0">
                  <HStack spacing={2} className="flex min-w-0 w-full">
                    <Heading className="truncate">{itemReadableId}</Heading>
                    <Button
                      asChild
                      variant="link"
                      size="sm"
                      className="text-muted-foreground flex-shrink-0"
                    >
                      <Link to={path.to.salesInvoiceLine(invoiceId, line.id!)}>
                        Edit
                      </Link>
                    </Button>
                  </HStack>
                  {description && (
                    <TruncatedTooltipText
                      className="text-muted-foreground text-sm truncate w-full"
                      tooltip={description}
                    >
                      {description}
                    </TruncatedTooltipText>
                  )}
                </VStack>
                <VStack spacing={2} className="flex-shrink-0 items-end w-auto">
                  <HStack spacing={4}>
                    <VStack spacing={0}>
                      <span className="font-semibold text-xl whitespace-nowrap">
                        {formatter.format(total)}
                      </span>
                      {shouldConvertCurrency && (
                        <span className="text-muted-foreground text-sm">
                          {presentationCurrencyFormatter.format(customerTotal)}
                        </span>
                      )}
                    </VStack>
                    <motion.div
                      animate={{
                        rotate: openItems.includes(line.id) ? 90 : 0
                      }}
                      transition={{ duration: 0.3 }}
                    >
                      <LuChevronRight size={24} />
                    </motion.div>
                  </HStack>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="flex items-center gap-2"
                    >
                      {line.quantity}
                      {line.invoiceLineType !== "Fixed Asset" &&
                        line.invoiceLineType !== "Rental" && (
                          <MethodIcon
                            type={line.methodType ?? "Pull from Inventory"}
                          />
                        )}
                    </Badge>
                    <Badge variant="green">
                      {formatter.format(line.unitPrice ?? 0)}{" "}
                      {
                        unitOfMeasures.find(
                          (uom) => uom.value === line.unitOfMeasureCode
                        )?.label
                      }
                    </Badge>
                    {discountPercent > 0 ? (
                      <Badge variant="secondary">
                        <Trans>{discount} off</Trans>
                      </Badge>
                    ) : null}
                    {(line.taxPercent ?? 0) > 0 ? (
                      <Badge variant="red">
                        {percentFormatter.format(line.taxPercent ?? 0)} Tax
                      </Badge>
                    ) : null}
                  </div>
                </VStack>
              </div>
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
          <div className="w-full">
            <Table>
              <Tbody>
                <Tr>
                  <Td>
                    <Trans>Quantity</Trans>
                  </Td>
                  <Td className="text-right">
                    <VStack spacing={0}>
                      <span>
                        {line.quantity}{" "}
                        {
                          unitOfMeasures.find(
                            (uom) => uom.value === line.unitOfMeasureCode
                          )?.label
                        }
                      </span>
                    </VStack>
                  </Td>
                </Tr>
                <Tr>
                  <Td>
                    <Trans>Unit Price</Trans>
                  </Td>
                  <Td className="text-right">
                    <VStack spacing={0}>
                      <span>{formatter.format(line.unitPrice ?? 0)}</span>
                      {shouldConvertCurrency && (
                        <span className="text-muted-foreground text-xs">
                          {presentationCurrencyFormatter.format(
                            line.convertedUnitPrice ?? 0
                          )}
                        </span>
                      )}
                      {discountPercent > 0 && (
                        <span className="text-muted-foreground text-xs">
                          <Trans>{discount} off</Trans>
                        </span>
                      )}
                    </VStack>
                  </Td>
                </Tr>
                <Tr>
                  <Td>Shipping Cost</Td>
                  <Td className="text-right">
                    <VStack spacing={0}>
                      <span>{formatter.format(line.shippingCost ?? 0)}</span>
                      {shouldConvertCurrency && (
                        <span className="text-muted-foreground text-xs">
                          {presentationCurrencyFormatter.format(
                            line.convertedShippingCost ?? 0
                          )}
                        </span>
                      )}
                    </VStack>
                  </Td>
                </Tr>
                <Tr className="border-b border-border">
                  <Td>
                    <Trans>Extended Price</Trans>
                  </Td>
                  <Td className="text-right">
                    <VStack spacing={0}>
                      <span>{formatter.format(lineSubtotal)}</span>
                      {shouldConvertCurrency && (
                        <span className="text-muted-foreground text-xs">
                          {presentationCurrencyFormatter.format(
                            customerSubtotal
                          )}
                        </span>
                      )}
                    </VStack>
                  </Td>
                </Tr>

                <Tr key="tax" className="border-b border-border">
                  <Td>Tax ({percentFormatter.format(line.taxPercent ?? 0)})</Td>
                  <Td className="text-right">
                    <VStack spacing={0}>
                      <span>{formatter.format(lineTaxAmount)}</span>
                      {shouldConvertCurrency && (
                        <span className="text-muted-foreground text-xs">
                          {presentationCurrencyFormatter.format(
                            customerLineTaxAmount
                          )}
                        </span>
                      )}
                    </VStack>
                  </Td>
                </Tr>

                <Tr key="total" className="font-semibold">
                  <Td>
                    <Trans>Total</Trans>
                  </Td>
                  <Td className="text-right">
                    <VStack spacing={0}>
                      <span>{formatter.format(total)}</span>
                      {shouldConvertCurrency && (
                        <span className="text-muted-foreground text-xs">
                          {presentationCurrencyFormatter.format(customerTotal)}
                        </span>
                      )}
                    </VStack>
                  </Td>
                </Tr>
              </Tbody>
            </Table>
          </div>
        </motion.div>
      </motion.div>
    );
  });

  if (isPhone) {
    return <SummaryLineList>{rows}</SummaryLineList>;
  }

  return (
    <VStack spacing={8} className="w-full overflow-hidden">
      {rows}
    </VStack>
  );
};
type SalesInvoiceSummaryProps = {
  onEditShippingCost: () => void;
};

const SalesInvoiceSummary = ({
  onEditShippingCost
}: SalesInvoiceSummaryProps) => {
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const routeData = useRouteData<{
    salesInvoice: SalesInvoice;
    salesInvoiceLines: SalesInvoiceLine[];
    salesInvoiceShipment: SalesInvoiceShipment;
  }>(path.to.salesInvoice(invoiceId));

  const { locale } = useLocale();
  const { company } = useUser();

  const shouldConvertCurrency =
    routeData?.salesInvoice?.currencyCode !== company?.baseCurrencyCode;

  const formatter = useCurrencyFormatter({
    currency: company?.baseCurrencyCode ?? "USD"
  });
  const presentationCurrencyFormatter = useCurrencyFormatter({
    currency: routeData?.salesInvoice?.currencyCode ?? "USD"
  });

  const isEditable = !isSalesInvoiceLocked(routeData?.salesInvoice?.status);

  // Calculate totals. Merchandise is NET of the line discount, as in the
  // `salesInvoices` view.
  const subtotal =
    routeData?.salesInvoiceLines?.reduce((acc, line) => {
      const lineSubtotal =
        (line.netUnitPrice ?? 0) * (line.quantity ?? 0) +
        (line.shippingCost ?? 0) +
        (line.addOnCost ?? 0) +
        (line.nonTaxableAddOnCost ?? 0);
      return acc + lineSubtotal;
    }, 0) ?? 0;

  const customerSubtotal =
    routeData?.salesInvoiceLines?.reduce((acc, line) => {
      const lineSubtotal =
        (line.convertedNetUnitPrice ?? 0) * (line.quantity ?? 0) +
        (line.convertedShippingCost ?? 0) +
        (line.convertedAddOnCost ?? 0) +
        (line.convertedNonTaxableAddOnCost ?? 0);

      return acc + lineSubtotal;
    }, 0) ?? 0;

  const tax =
    routeData?.salesInvoiceLines?.reduce((acc, line) => {
      const lineTaxAmount =
        (line.taxPercent ?? 0) *
        ((line.netUnitPrice ?? 0) * (line.quantity ?? 0) +
          (line.shippingCost ?? 0) +
          (line.addOnCost ?? 0));
      return acc + lineTaxAmount;
    }, 0) ?? 0;

  const customerTax =
    routeData?.salesInvoiceLines?.reduce((acc, line) => {
      const lineTaxAmount =
        (line.taxPercent ?? 0) *
        ((line.convertedNetUnitPrice ?? 0) * (line.quantity ?? 0) +
          (line.convertedShippingCost ?? 0) +
          (line.convertedAddOnCost ?? 0));
      return acc + lineTaxAmount;
    }, 0) ?? 0;

  // `salesInvoiceShipment.shippingCost` is stored in BASE currency, like every
  // other raw column on this side -- the `salesInvoices` view adds it straight
  // onto a base subtotal built from `unitPrice`. So the base figure is the
  // stored value and only the customer-facing one converts.
  const shippingCost = routeData?.salesInvoiceShipment?.shippingCost ?? 0;

  const customerShippingCost =
    (routeData?.salesInvoiceShipment?.shippingCost ?? 0) *
    (routeData?.salesInvoice?.exchangeRate ?? 1);

  const total = subtotal + tax + shippingCost;
  const customerTotal = customerSubtotal + customerTax + customerShippingCost;

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between items-center">
          <div className="flex flex-col gap-1">
            <CardTitle>{routeData?.salesInvoice.invoiceId}</CardTitle>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <CustomerAvatar
              customerId={routeData?.salesInvoice.customerId ?? null}
            />
            {routeData?.salesInvoice?.dateDue && (
              <span className="text-xs text-muted-foreground tracking-tight">
                Due{" "}
                <DateTime
                  value={routeData?.salesInvoice.dateDue}
                  variant="date"
                />
              </span>
            )}
          </div>
        </HStack>
      </CardHeader>
      <CardContent>
        <LineItems
          currencyCode={company?.baseCurrencyCode ?? "USD"}
          presentationCurrencyFormatter={presentationCurrencyFormatter}
          formatter={formatter}
          locale={locale}
          salesInvoiceLines={routeData?.salesInvoiceLines ?? []}
          shouldConvertCurrency={shouldConvertCurrency}
        />

        <VStack spacing={2} className="mt-8">
          <HStack className="justify-between text-sm text-muted-foreground w-full">
            <span>Subtotal:</span>
            <VStack spacing={0} className="items-end">
              <span>{formatter.format(subtotal)}</span>
              {shouldConvertCurrency && (
                <span className="text-sm">
                  {presentationCurrencyFormatter.format(customerSubtotal)}
                </span>
              )}
            </VStack>
          </HStack>

          <HStack className="justify-between text-sm text-muted-foreground w-full">
            <span>Tax:</span>
            <VStack spacing={0} className="items-end">
              <span>{formatter.format(tax)}</span>
              {shouldConvertCurrency && (
                <span className="text-sm">
                  {presentationCurrencyFormatter.format(customerTax)}
                </span>
              )}
            </VStack>
          </HStack>

          <HStack className="justify-between text-sm text-muted-foreground w-full">
            {shippingCost > 0 ? (
              <>
                <VStack spacing={0}>
                  <span>Shipping:</span>
                  {isEditable && (
                    <Button
                      variant="link"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={onEditShippingCost}
                    >
                      <Trans>Edit Shipping</Trans>
                    </Button>
                  )}
                </VStack>
                <VStack spacing={0} className="items-end">
                  <span>{formatter.format(shippingCost)}</span>
                  {shouldConvertCurrency && (
                    <span className="text-sm">
                      {presentationCurrencyFormatter.format(
                        customerShippingCost
                      )}
                    </span>
                  )}
                </VStack>
              </>
            ) : isEditable ? (
              <Button
                variant="link"
                size="sm"
                className="text-primary"
                onClick={onEditShippingCost}
              >
                <Trans>Add Shipping</Trans>
              </Button>
            ) : null}
          </HStack>

          <HStack className="justify-between text-xl font-semibold w-full">
            <span>Total:</span>
            <VStack spacing={0} className="items-end">
              <span>{formatter.format(total)}</span>
              {shouldConvertCurrency && (
                <span className="text-sm">
                  {presentationCurrencyFormatter.format(customerTotal)}
                </span>
              )}
            </VStack>
          </HStack>
        </VStack>
      </CardContent>
    </Card>
  );
};

export default SalesInvoiceSummary;
