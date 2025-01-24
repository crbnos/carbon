import {
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  VStack,
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { Link, useParams } from "@remix-run/react";
import { motion } from "framer-motion";
import MotionNumber from "motion-number";
import { useMemo, useState } from "react";
import { LuChevronDown, LuImage, LuInfo } from "react-icons/lu";
import { CustomerAvatar } from "~/components";
import { usePercentFormatter, useRouteData } from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";
import type {
  Customer,
  Quotation,
  SalesOrder,
  SalesOrderLine,
} from "../../types";

const SalesOrderSummary = ({
  onEditShippingCost,
}: {
  onEditShippingCost: () => void;
}) => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const routeData = useRouteData<{
    salesOrder: SalesOrder;
    lines: SalesOrderLine[];
    customer: Customer;
    quote: Quotation;
  }>(path.to.salesOrder(orderId));

  const { locale } = useLocale();
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: routeData?.salesOrder?.currencyCode ?? "USD",
      }),
    [locale, routeData?.salesOrder?.currencyCode]
  );

  const isEditable = ["Draft", "To Review"].includes(
    routeData?.salesOrder?.status ?? ""
  );

  // Calculate totals
  const subtotal =
    routeData?.lines?.reduce((acc, line) => {
      const lineTotal =
        (line.convertedUnitPrice ?? 0) * (line.saleQuantity ?? 0);
      const addOns =
        (line.convertedAddOnCost ?? 0) + (line.convertedShippingCost ?? 0);
      return acc + lineTotal + addOns;
    }, 0) ?? 0;

  const tax =
    routeData?.lines?.reduce((acc, line) => {
      const lineTotal =
        (line.convertedUnitPrice ?? 0) * (line.saleQuantity ?? 0);
      const addOns =
        (line.convertedAddOnCost ?? 0) + (line.convertedShippingCost ?? 0);
      return acc + (lineTotal + addOns) * (line.taxPercent ?? 0);
    }, 0) ?? 0;

  const convertedShippingCost =
    (routeData?.salesOrder?.exchangeRate ?? 1) *
    (routeData?.salesOrder?.shippingCost ?? 0);
  const total = subtotal + tax + convertedShippingCost;

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between items-center">
          <div className="flex flex-col gap-1">
            <CardTitle>{routeData?.salesOrder.salesOrderId}</CardTitle>
            <CardDescription>Sales Order</CardDescription>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <CustomerAvatar
              customerId={routeData?.salesOrder.customerId ?? null}
            />
            {routeData?.salesOrder?.orderDate && (
              <span className="text-muted-foreground text-sm">
                Ordered {formatDate(routeData?.salesOrder.orderDate)}
              </span>
            )}
            {routeData?.quote?.digitalQuoteAcceptedBy && (
              <span className="text-muted-foreground text-sm flex flex-row items-center gap-x-1">
                via Digital Quote
                <Tooltip>
                  <TooltipTrigger>
                    <LuInfo className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="flex flex-col gap-y-0">
                      <span>{routeData?.quote?.digitalQuoteAcceptedBy}</span>
                      <span>
                        {routeData?.quote?.digitalQuoteAcceptedByEmail}
                      </span>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </span>
            )}
          </div>
        </HStack>
      </CardHeader>
      <CardContent>
        <LineItems
          currencyCode={routeData?.salesOrder?.currencyCode ?? "USD"}
          locale={locale}
          formatter={formatter}
          lines={routeData?.lines ?? []}
        />

        <VStack spacing={2} className="mt-8">
          <HStack className="justify-between text-base text-muted-foreground w-full">
            <span>Subtotal:</span>
            <MotionNumber
              value={subtotal}
              format={{
                style: "currency",
                currency: routeData?.salesOrder?.currencyCode ?? "USD",
              }}
              locales={locale}
            />
          </HStack>
          <HStack className="justify-between text-base text-muted-foreground w-full">
            <span>Tax:</span>
            <MotionNumber
              value={tax}
              format={{
                style: "currency",
                currency: routeData?.salesOrder?.currencyCode ?? "USD",
              }}
              locales={locale}
            />
          </HStack>
          <HStack className="justify-between text-base text-muted-foreground w-full">
            {convertedShippingCost > 0 ? (
              <>
                <VStack spacing={0}>
                  <span>Shipping:</span>
                  <Button
                    variant="link"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={onEditShippingCost}
                  >
                    Edit Shipping
                  </Button>
                </VStack>
                <MotionNumber
                  value={convertedShippingCost}
                  format={{
                    style: "currency",
                    currency: routeData?.salesOrder.currencyCode ?? "USD",
                  }}
                  locales={locale}
                />
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
            <MotionNumber
              value={total}
              format={{
                style: "currency",
                currency: routeData?.salesOrder?.currencyCode ?? "USD",
              }}
              locales={locale}
            />
          </HStack>
        </VStack>
      </CardContent>
    </Card>
  );
};

function LineItems({
  currencyCode,
  formatter,
  locale,
  lines,
}: {
  currencyCode: string;
  formatter: Intl.NumberFormat;
  locale: string;
  lines: SalesOrderLine[];
}) {
  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const percentFormatter = usePercentFormatter();
  const [openItems, setOpenItems] = useState<string[]>([]);

  const toggleOpen = (id: string) => {
    setOpenItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <VStack spacing={8} className="w-full overflow-hidden">
      {lines.map((line) => {
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
              {line.thumbnailPath ? (
                <img
                  alt={line.itemReadableId!}
                  className="w-24 h-24 bg-gradient-to-bl from-muted to-muted/40 rounded-lg"
                  src={getPrivateUrl(line.thumbnailPath)}
                />
              ) : (
                <div className="w-20 h-20 bg-gradient-to-bl from-muted to-muted/40 rounded-lg p-2">
                  <LuImage className="w-16 h-16 text-muted-foreground" />
                </div>
              )}

              <VStack spacing={0} className="w-full">
                <div
                  className="flex flex-col cursor-pointer w-full"
                  onClick={() => toggleOpen(line.id!)}
                >
                  <div className="flex items-center gap-x-4 justify-between flex-grow min-w-0">
                    <HStack spacing={2} className="min-w-0 flex-shrink">
                      <Heading className="truncate">
                        {line.itemReadableId}
                      </Heading>
                      <Button
                        asChild
                        variant="link"
                        size="sm"
                        className="text-muted-foreground flex-shrink-0"
                      >
                        <Link to={path.to.salesOrderLine(orderId, line.id!)}>
                          Edit
                        </Link>
                      </Button>
                    </HStack>
                    <HStack spacing={4} className="flex-shrink-0 ml-4">
                      <MotionNumber
                        className="font-bold text-xl whitespace-nowrap"
                        value={
                          ((line?.convertedUnitPrice ?? 0) *
                            (line?.saleQuantity ?? 0) +
                            (line?.convertedAddOnCost ?? 0) +
                            (line?.convertedShippingCost ?? 0)) *
                          (1 + (line?.taxPercent ?? 0))
                        }
                        format={{
                          style: "currency",
                          currency: currencyCode,
                        }}
                        locales={locale}
                      />
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
                      <Td className="text-right">{line.saleQuantity}</Td>
                    </Tr>
                    <Tr>
                      <Td>Unit Price</Td>
                      <Td className="text-right">
                        <MotionNumber
                          value={line.convertedUnitPrice ?? 0}
                          format={{ style: "currency", currency: currencyCode }}
                          locales={locale}
                        />
                      </Td>
                    </Tr>
                    <Tr className="border-b border-border">
                      <Td>Extended Price</Td>
                      <Td className="text-right">
                        <MotionNumber
                          value={
                            (line.convertedUnitPrice ?? 0) *
                            (line.saleQuantity ?? 0)
                          }
                          format={{ style: "currency", currency: currencyCode }}
                          locales={locale}
                        />
                      </Td>
                    </Tr>

                    {Number(line.addOnCost ?? 0) > 0 && (
                      <Tr>
                        <Td>Additional Charges</Td>
                        <Td className="text-right">
                          <MotionNumber
                            value={line.addOnCost ?? 0}
                            format={{
                              style: "currency",
                              currency: currencyCode,
                            }}
                            locales={locale}
                          />
                        </Td>
                      </Tr>
                    )}

                    <Tr key="subtotal">
                      <Td>Subtotal</Td>
                      <Td className="text-right">
                        <MotionNumber
                          value={
                            (line.convertedUnitPrice ?? 0) *
                              (line.saleQuantity ?? 0) +
                            (line.convertedAddOnCost ?? 0) +
                            (line.convertedShippingCost ?? 0)
                          }
                          format={{
                            style: "currency",
                            currency: currencyCode,
                          }}
                          locales={locale}
                        />
                      </Td>
                    </Tr>

                    <Tr key="tax" className="border-b border-border">
                      <Td>
                        Tax ({percentFormatter.format(line.taxPercent ?? 0)})
                      </Td>
                      <Td className="text-right">
                        <MotionNumber
                          value={
                            ((line.convertedUnitPrice ?? 0) *
                              (line.saleQuantity ?? 0) +
                              (line.convertedAddOnCost ?? 0) +
                              (line.convertedShippingCost ?? 0)) *
                            (line.taxPercent ?? 0)
                          }
                          format={{
                            style: "currency",
                            currency: currencyCode,
                          }}
                          locales={locale}
                        />
                      </Td>
                    </Tr>

                    <Tr key="total" className="font-bold">
                      <Td>Total</Td>
                      <Td className="text-right">
                        <MotionNumber
                          value={
                            ((line.convertedUnitPrice ?? 0) *
                              (line.saleQuantity ?? 0) +
                              (line.convertedAddOnCost ?? 0) +
                              (line.convertedShippingCost ?? 0)) *
                            (1 + (line.taxPercent ?? 0))
                          }
                          format={{
                            style: "currency",
                            currency: currencyCode,
                          }}
                          locales={locale}
                        />
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
}

export default SalesOrderSummary;
