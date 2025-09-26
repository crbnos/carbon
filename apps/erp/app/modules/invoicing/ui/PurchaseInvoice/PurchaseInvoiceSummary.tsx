import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Table,
  Tbody,
  Td,
  Tr,
  VStack,
} from "@carbon/react";
import { formatDate, getItemReadableId } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { Link, useParams } from "@remix-run/react";
import { motion } from "framer-motion";
import { useState } from "react";
import { LuChevronRight, LuImage } from "react-icons/lu";
import { MethodIcon, SupplierAvatar } from "~/components";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  useRouteData,
  useUser,
} from "~/hooks";
import { useItems } from "~/stores";
import { getPrivateUrl, path } from "~/utils/path";
import type {
  PurchaseInvoice,
  PurchaseInvoiceDelivery,
  PurchaseInvoiceLine,
} from "../../types";

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
  const [items] = useItems();
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

        const itemReadableId = getItemReadableId(items, line.itemId);
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
                  alt={itemReadableId ?? ""}
                  className="w-24 h-24 bg-gradient-to-bl from-muted to-muted/40 rounded-lg"
                  src={getPrivateUrl(line.thumbnailPath)}
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
                  <div className="flex items-center justify-between w-full">
                    <VStack
                      spacing={0}
                      className="flex-shrink-0 min-w-0 w-auto"
                    >
                      <HStack
                        spacing={2}
                        className="flex min-w-0 flex-shrink-0"
                      >
                        <Heading className="truncate">{itemReadableId}</Heading>
                        <Button
                          asChild
                          variant="link"
                          size="sm"
                          className="text-muted-foreground flex-shrink-0"
                        >
                          <Link
                            to={path.to.purchaseInvoiceLine(invoiceId, line.id!)}
                          >
                            Edit
                          </Link>
                        </Button>
                      </HStack>
                      <span className="text-muted-foreground text-base truncate">
                        {line.description}
                      </span>
                    </VStack>
                    <VStack
                      spacing={2}
                      className="flex-shrink-0 items-end w-auto"
                    >
                      <HStack spacing={4}>
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
                            rotate: openItems.includes(line.id) ? 90 : 0,
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
                          <MethodIcon type={line.methodType ?? "Pick"} />
                        </Badge>
                        <Badge variant="green">
                          {formatter.format(
                            line.unitPrice ?? 0
                          )}{" "}
                          {
                            unitOfMeasures.find(
                              (uom) =>
                                uom.value === line.purchaseUnitOfMeasureCode
                            )?.label
                          }
                        </Badge>
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
type PurchaseInvoiceSummaryProps = {
  onEditShippingCost: () => void;
};

const PurchaseInvoiceSummary = ({
  onEditShippingCost,
}: PurchaseInvoiceSummaryProps) => {
  const { invoiceId } = useParams();
  if (!invoiceId) throw new Error("Could not find invoiceId");

  const routeData = useRouteData<{
    purchaseInvoice: PurchaseInvoice;
    purchaseInvoiceLines: PurchaseInvoiceLine[];
    purchaseInvoiceDelivery: PurchaseInvoiceDelivery;
  }>(path.to.purchaseInvoice(invoiceId));

  const { locale } = useLocale();
  const { company } = useUser();

  const shouldConvertCurrency =
    routeData?.purchaseInvoice?.currencyCode !== company?.baseCurrencyCode;

  const formatter = useCurrencyFormatter({
    currency: company?.baseCurrencyCode ?? "USD",
  });
  const presentationCurrencyFormatter = useCurrencyFormatter({
    currency: routeData?.purchaseInvoice?.currencyCode ?? "USD",
  });

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.purchaseInvoice?.status ?? ""
  );

  // Calculate totals
  const subtotal =
    routeData?.purchaseInvoiceLines?.reduce((acc, line) => {
      const lineTotal =
        (line.unitPrice ?? 0) * (line.quantity ?? 0) + (line.shippingCost ?? 0);
      return acc + lineTotal;
    }, 0) ?? 0;

  const supplierSubtotal =
    routeData?.purchaseInvoiceLines?.reduce((acc, line) => {
      const lineTotal =
        (line.supplierUnitPrice ?? 0) * (line.quantity ?? 0) +
        (line.supplierShippingCost ?? 0);
      return acc + lineTotal;
    }, 0) ?? 0;

  const tax =
    routeData?.purchaseInvoiceLines?.reduce((acc, line) => {
      return acc + (line.taxAmount ?? 0);
    }, 0) ?? 0;

  const supplierTax =
    routeData?.purchaseInvoiceLines?.reduce((acc, line) => {
      return acc + (line.supplierTaxAmount ?? 0);
    }, 0) ?? 0;

  const shippingCost =
    (routeData?.purchaseInvoiceDelivery?.supplierShippingCost ?? 0) *
    (routeData?.purchaseInvoice?.exchangeRate ?? 1);

  const supplierShippingCost =
    routeData?.purchaseInvoiceDelivery?.supplierShippingCost ?? 0;

  const total = subtotal + tax + shippingCost;
  const supplierTotal = supplierSubtotal + supplierTax + supplierShippingCost;

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between items-center">
          <div className="flex flex-col gap-1">
            <CardTitle>{routeData?.purchaseInvoice.invoiceId}</CardTitle>
            <CardDescription>Purchase Invoice</CardDescription>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <SupplierAvatar
              supplierId={routeData?.purchaseInvoice.supplierId ?? null}
            />
            {routeData?.purchaseInvoice?.dateDue && (
              <span className="text-muted-foreground text-sm">
                Due {formatDate(routeData?.purchaseInvoice.dateDue)}
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

          <HStack className="justify-between text-base text-muted-foreground w-full">
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
                      Edit Shipping
                    </Button>
                  )}
                </VStack>
                <VStack spacing={0} className="items-end">
                  <span>{formatter.format(shippingCost)}</span>
                  {shouldConvertCurrency && (
                    <span className="text-sm">
                      {presentationCurrencyFormatter.format(
                        supplierShippingCost
                      )}
                    </span>
                  )}
                </VStack>
              </>
            ) : isEditable ? (
              <Button
                variant="link"
                size="sm"
                className="text-muted-foreground"
                onClick={onEditShippingCost}
              >
                Add Shipping
              </Button>
            ) : null}
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
