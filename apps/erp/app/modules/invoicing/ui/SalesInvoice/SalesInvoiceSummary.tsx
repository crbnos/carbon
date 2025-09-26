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
import { CustomerAvatar, MethodIcon } from "~/components";
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
  SalesInvoice,
  SalesInvoiceLine,
  SalesInvoiceShipment,
} from "../../types";

const LineItems = ({
  currencyCode,
  presentationCurrencyFormatter,
  formatter,
  locale,
  salesInvoiceLines,
  shouldConvertCurrency,
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

  const [items] = useItems();
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
      {salesInvoiceLines.map((line) => {
        if (!line.id) return null;

        const itemReadableId = getItemReadableId(items, line.itemId);
        const lineSubtotal = (line.unitPrice ?? 0) * (line.quantity ?? 0);
        const customerSubtotal =
          (line.convertedUnitPrice ?? 0) * (line.quantity ?? 0);
        const total =
          (lineSubtotal + (line.addOnCost ?? 0) + (line.shippingCost ?? 0)) *
          (1 + (line.taxPercent ?? 0));
        const customerTotal =
          (customerSubtotal +
            (line.convertedAddOnCost ?? 0) +
            (line.convertedShippingCost ?? 0)) *
          (1 + (line.taxPercent ?? 0));

        const lineTaxAmount =
          (line.taxPercent ?? 0) *
          (lineSubtotal + (line.addOnCost ?? 0) + (line.shippingCost ?? 0));

        const customerLineTaxAmount =
          (line.taxPercent ?? 0) *
          (customerSubtotal +
            (line.convertedAddOnCost ?? 0) +
            (line.convertedShippingCost ?? 0));

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
                            to={path.to.salesInvoiceLine(invoiceId, line.id!)}
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
                                customerTotal
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
                              (uom) => uom.value === line.unitOfMeasureCode
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
                                (uom) => uom.value === line.unitOfMeasureCode
                              )?.label
                            }
                          </span>
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
                                line.convertedUnitPrice ?? 0
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
                                line.convertedShippingCost ?? 0
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
                      <Td>
                        Tax ({percentFormatter.format(line.taxPercent ?? 0)})
                      </Td>
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

                    <Tr key="total" className="font-bold">
                      <Td>Total</Td>
                      <Td className="text-right">
                        <VStack spacing={0}>
                          <span>{formatter.format(total)}</span>
                          {shouldConvertCurrency && (
                            <span className="text-muted-foreground text-xs">
                              {presentationCurrencyFormatter.format(
                                customerTotal
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
type SalesInvoiceSummaryProps = {
  onEditShippingCost: () => void;
};

const SalesInvoiceSummary = ({
  onEditShippingCost,
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
    currency: company?.baseCurrencyCode ?? "USD",
  });
  const presentationCurrencyFormatter = useCurrencyFormatter({
    currency: routeData?.salesInvoice?.currencyCode ?? "USD",
  });

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.salesInvoice?.status ?? ""
  );

  // Calculate totals
  const subtotal =
    routeData?.salesInvoiceLines?.reduce((acc, line) => {
      const lineSubtotal =
        (line.unitPrice ?? 0) * (line.quantity ?? 0) +
        (line.shippingCost ?? 0) +
        (line.addOnCost ?? 0);
      return acc + lineSubtotal;
    }, 0) ?? 0;

  const customerSubtotal =
    routeData?.salesInvoiceLines?.reduce((acc, line) => {
      const lineSubtotal =
        (line.convertedUnitPrice ?? 0) * (line.quantity ?? 0) +
        (line.convertedShippingCost ?? 0) +
        (line.convertedAddOnCost ?? 0);

      return acc + lineSubtotal;
    }, 0) ?? 0;

  const tax =
    routeData?.salesInvoiceLines?.reduce((acc, line) => {
      const lineTaxAmount =
        (line.taxPercent ?? 0) *
        ((line.unitPrice ?? 0) * (line.quantity ?? 0) +
          (line.shippingCost ?? 0) +
          (line.addOnCost ?? 0));
      return acc + lineTaxAmount;
    }, 0) ?? 0;

  const customerTax =
    routeData?.salesInvoiceLines?.reduce((acc, line) => {
      const lineTaxAmount =
        (line.taxPercent ?? 0) *
        ((line.convertedUnitPrice ?? 0) * (line.quantity ?? 0) +
          (line.convertedShippingCost ?? 0) +
          (line.convertedAddOnCost ?? 0));
      return acc + lineTaxAmount;
    }, 0) ?? 0;

  const shippingCost =
    (routeData?.salesInvoiceShipment?.shippingCost ?? 0) *
    (routeData?.salesInvoice?.exchangeRate ?? 1);

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
            <CardDescription>Sales Invoice</CardDescription>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <CustomerAvatar
              customerId={routeData?.salesInvoice.customerId ?? null}
            />
            {routeData?.salesInvoice?.dateDue && (
              <span className="text-muted-foreground text-sm">
                Due {formatDate(routeData?.salesInvoice.dateDue)}
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
          <HStack className="justify-between text-base text-muted-foreground w-full">
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

          <HStack className="justify-between text-base text-muted-foreground w-full">
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
