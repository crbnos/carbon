import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  IconButton,
  Table,
  Tbody,
  Td,
  Tr,
  VStack,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { Link, useParams } from "@remix-run/react";
import { motion } from "framer-motion";
import { useState } from "react";
import { LuChevronDown, LuExternalLink, LuImage } from "react-icons/lu";
import { SupplierAvatar } from "~/components";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  useRouteData,
  useUser,
} from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "../../types";

const LineItems = ({
  currencyCode,
  presentationCurrencyFormatter,
  formatter,
  locale,
  purchaseInvoiceLines,
  shouldConvertCurrency,
}: {
  currencyCode: string;
  presentationCurrencyFormatter: Intl.NumberFormat;
  formatter: Intl.NumberFormat;
  locale: string;
  purchaseInvoiceLines: PurchaseInvoiceLine[];
  shouldConvertCurrency: boolean;
}) => {
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const percentFormatter = usePercentFormatter();
  const [openItems, setOpenItems] = useState<string[]>([]);
  const unitOfMeasures = useUnitOfMeasure();

  const toggleOpen = (id: string) => {
    setOpenItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <VStack spacing={8} className="w-full overflow-hidden">
      {purchaseInvoiceLines.map((line) => {
        if (!line.id) return null;

        const lineTotal = (line.unitPrice ?? 0) * (line.quantity ?? 0);
        const supplierLineTotal =
          (line.supplierUnitPrice ?? 0) * (line.quantity ?? 0);
        const total =
          lineTotal + (line.taxAmount ?? 0) + (line.shippingCost ?? 0);
        const supplierTotal =
          supplierLineTotal +
          (line.supplierTaxAmount ?? 0) +
          (line.supplierShippingCost ?? 0);

        return (
          <motion.div
            key={line.id}
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="border-b border-input py-6 w-full"
          >
            <HStack spacing={4} className="items-start">
              {line.thumbnailPath ? (
                <img
                  alt={line.itemReadableId!}
                  className="w-24 h-24 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent"
                  src={getPrivateUrl(line.thumbnailPath)}
                />
              ) : (
                <div className="w-20 h-20 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent p-2">
                  <LuImage className="w-16 h-16 text-muted-foreground" />
                </div>
              )}

              <VStack spacing={0} className="w-full">
                <div
                  className="flex flex-col cursor-pointer w-full"
                  onClick={() => toggleOpen(line.id!)}
                >
                  <div className="flex items-center gap-x-4 justify-between flex-grow min-w-0">
                    <HStack spacing={0} className="min-w-0 flex-shrink ">
                      <Heading className="truncate">
                        {line.itemReadableId}
                      </Heading>

                      <Link
                        to={path.to.purchaseInvoiceLine(invoiceId, line.id!)}
                        className="text-muted-foreground flex-shrink-0"
                      >
                        <IconButton
                          aria-label="View Line Item"
                          icon={<LuExternalLink />}
                          variant="ghost"
                        />
                      </Link>
                    </HStack>
                    <HStack spacing={4} className="flex-shrink-0 ml-4">
                      <VStack spacing={0}>
                        <span className="font-bold text-xl whitespace-nowrap">
                          {formatter.format(total)}
                        </span>
                        {shouldConvertCurrency && (
                          <span className="text-muted-foreground text-sm">
                            {presentationCurrencyFormatter.format(
                              supplierTotal
                            )}
                          </span>
                        )}
                      </VStack>
                      <motion.div
                        animate={{
                          rotate: openItems.includes(line.id) ? 180 : 0,
                        }}
                        transition={{ duration: 0.3 }}
                      >
                        <LuChevronDown size={24} />
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
                collapsed: { opacity: 0, height: 0, marginTop: 0 },
              }}
              transition={{ duration: 0.3 }}
              className="w-full overflow-hidden"
            >
              <div className="w-full">
                <Table>
                  <Tbody>
                    <Tr>
                      <Td>Quantity</Td>
                      <Td className="text-right">
                        <VStack spacing={0}>
                          <span>
                            {line.quantity}{" "}
                            {
                              unitOfMeasures.find(
                                (uom) =>
                                  uom.value === line.purchaseUnitOfMeasureCode
                              )?.label
                            }
                          </span>
                          {line.conversionFactor !== 1 && (
                            <span className="text-muted-foreground text-xs">
                              {(line.quantity ?? 0) *
                                (line.conversionFactor ?? 1)}{" "}
                              {
                                unitOfMeasures.find(
                                  (uom) =>
                                    uom.value ===
                                    line.inventoryUnitOfMeasureCode
                                )?.label
                              }
                            </span>
                          )}
                        </VStack>
                      </Td>
                    </Tr>
                    <Tr>
                      <Td>Unit Price</Td>
                      <Td className="text-right">
                        <VStack spacing={0}>
                          <span>{formatter.format(line.unitPrice ?? 0)}</span>
                          {shouldConvertCurrency && (
                            <span className="text-muted-foreground text-xs">
                              {presentationCurrencyFormatter.format(
                                line.supplierUnitPrice ?? 0
                              )}
                            </span>
                          )}
                        </VStack>
                      </Td>
                    </Tr>
                    <Tr>
                      <Td>Shipping Cost</Td>
                      <Td className="text-right">
                        <VStack spacing={0}>
                          <span>
                            {formatter.format(line.shippingCost ?? 0)}
                          </span>
                          {shouldConvertCurrency && (
                            <span className="text-muted-foreground text-xs">
                              {presentationCurrencyFormatter.format(
                                line.supplierShippingCost ?? 0
                              )}
                            </span>
                          )}
                        </VStack>
                      </Td>
                    </Tr>
                    <Tr className="border-b border-border">
                      <Td>Extended Price</Td>
                      <Td className="text-right">
                        <VStack spacing={0}>
                          <span>{formatter.format(lineTotal)}</span>
                          {shouldConvertCurrency && (
                            <span className="text-muted-foreground text-xs">
                              {presentationCurrencyFormatter.format(
                                supplierLineTotal
                              )}
                            </span>
                          )}
                        </VStack>
                      </Td>
                    </Tr>

                    <Tr key="tax" className="border-b border-border">
                      <Td>
                        Tax ({percentFormatter.format(line.taxPercent ?? 0)})
                      </Td>
                      <Td className="text-right">
                        <VStack spacing={0}>
                          <span>{formatter.format(line.taxAmount ?? 0)}</span>
                          {shouldConvertCurrency && (
                            <span className="text-muted-foreground text-xs">
                              {presentationCurrencyFormatter.format(
                                line.supplierTaxAmount ?? 0
                              )}
                            </span>
                          )}
                        </VStack>
                      </Td>
                    </Tr>

                    <Tr key="total" className="font-bold">
                      <Td>Total</Td>
                      <Td className="text-right">
                        <VStack spacing={0}>
                          <span>{formatter.format(total)}</span>
                          {shouldConvertCurrency && (
                            <span className="text-muted-foreground text-xs">
                              {presentationCurrencyFormatter.format(
                                supplierTotal
                              )}
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
      })}
    </VStack>
  );
};

const PurchaseInvoiceSummary = () => {
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const routeData = useRouteData<{
    purchaseInvoice: PurchaseInvoice;
    purchaseInvoiceLines: PurchaseInvoiceLine[];
  }>(path.to.purchaseInvoice(invoiceId));

  const { locale } = useLocale();
  const { company } = useUser();

  const shouldConvertCurrency =
    routeData?.purchaseInvoice?.currencyCode !== company?.baseCurrencyCode;

  const formatter = useCurrencyFormatter(company?.baseCurrencyCode ?? "USD");
  const presentationCurrencyFormatter = useCurrencyFormatter(
    routeData?.purchaseInvoice?.currencyCode ?? "USD"
  );

  // Calculate totals
  const subtotal =
    routeData?.purchaseInvoiceLines?.reduce((acc, line) => {
      const lineTotal = (line.unitPrice ?? 0) * (line.quantity ?? 0);
      const shippingCost = line.shippingCost ?? 0;
      return acc + lineTotal + shippingCost;
    }, 0) ?? 0;

  const supplierSubtotal =
    routeData?.purchaseInvoiceLines?.reduce((acc, line) => {
      const lineTotal = (line.supplierUnitPrice ?? 0) * (line.quantity ?? 0);
      const shippingCost = line.supplierShippingCost ?? 0;
      return acc + lineTotal + shippingCost;
    }, 0) ?? 0;

  const tax =
    routeData?.purchaseInvoiceLines?.reduce((acc, line) => {
      return acc + (line.taxAmount ?? 0);
    }, 0) ?? 0;

  const supplierTax =
    routeData?.purchaseInvoiceLines?.reduce((acc, line) => {
      return acc + (line.supplierTaxAmount ?? 0);
    }, 0) ?? 0;

  const total = subtotal + tax;
  const supplierTotal = supplierSubtotal + supplierTax;

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between items-center">
          <div className="flex flex-col gap-1">
            <CardTitle>
              Purchase Invoice {routeData?.purchaseInvoice.invoiceId}
            </CardTitle>
            {routeData?.purchaseInvoice?.dateDue && (
              <CardDescription>
                Due {formatDate(routeData.purchaseInvoice.dateDue)}
              </CardDescription>
            )}
          </div>
          <SupplierAvatar
            supplierId={routeData?.purchaseInvoice?.supplierId ?? null}
          />
        </HStack>
      </CardHeader>
      <CardContent>
        <LineItems
          currencyCode={company?.baseCurrencyCode ?? "USD"}
          presentationCurrencyFormatter={presentationCurrencyFormatter}
          formatter={formatter}
          locale={locale}
          purchaseInvoiceLines={routeData?.purchaseInvoiceLines ?? []}
          shouldConvertCurrency={shouldConvertCurrency}
        />

        <VStack spacing={2} className="mt-8">
          <HStack className="justify-between text-base text-muted-foreground w-full">
            <span>Subtotal:</span>
            <VStack spacing={0} className="items-end">
              <span>{formatter.format(subtotal)}</span>
              {shouldConvertCurrency && (
                <span className="text-sm">
                  {presentationCurrencyFormatter.format(supplierSubtotal)}
                </span>
              )}
            </VStack>
          </HStack>
          <HStack className="justify-between text-base text-muted-foreground w-full">
            <span>Tax:</span>
            <VStack spacing={0} className="items-end">
              <span>{formatter.format(tax)}</span>
              {shouldConvertCurrency && (
                <span className="text-sm">
                  {presentationCurrencyFormatter.format(supplierTax)}
                </span>
              )}
            </VStack>
          </HStack>

          <HStack className="justify-between text-xl font-bold w-full">
            <span>Total:</span>
            <VStack spacing={0} className="items-end">
              <span>{formatter.format(total)}</span>
              {shouldConvertCurrency && (
                <span className="text-sm">
                  {presentationCurrencyFormatter.format(supplierTotal)}
                </span>
              )}
            </VStack>
          </HStack>
        </VStack>
      </CardContent>
    </Card>
  );
};

export default PurchaseInvoiceSummary;
