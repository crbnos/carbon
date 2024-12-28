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
import MotionNumber from "motion-number";
import { useMemo, useState } from "react";
import { LuChevronDown, LuExternalLink, LuImage } from "react-icons/lu";
import { CustomerAvatar } from "~/components";
import { usePercentFormatter, useRouteData } from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";
import type { SalesOrderLine } from "../../types";

const LineItems = ({
  currencyCode,
  formatter,
  locale,
  lines,
}: {
  currencyCode: string;
  formatter: Intl.NumberFormat;
  locale: string;
  lines: SalesOrderLine[];
}) => {
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
                        to={path.to.salesOrderLine(orderId, line.id!)}
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
};

const SalesOrderSummary = () => {
  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const routeData = useRouteData<{
    salesOrder: any;
    lines: any[];
    customer: any;
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

  const shippingCost =
    (routeData?.salesOrder?.shippingCost ?? 0) *
    (routeData?.salesOrder?.exchangeRate ?? 1);
  const total = subtotal + tax + shippingCost;

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between items-center">
          <div className="flex flex-col gap-1">
            <CardTitle>
              Sales Order {routeData?.salesOrder.salesOrderId}
            </CardTitle>
            {routeData?.salesOrder?.orderDate && (
              <CardDescription>
                Ordered {formatDate(routeData.salesOrder.orderDate)}
              </CardDescription>
            )}
          </div>
          <CustomerAvatar
            customerId={routeData?.salesOrder?.customerId ?? null}
          />
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
          {shippingCost > 0 && (
            <HStack className="justify-between text-base text-muted-foreground w-full">
              <span>Shipping:</span>
              <MotionNumber
                value={shippingCost}
                format={{
                  style: "currency",
                  currency: routeData?.salesOrder?.currencyCode ?? "USD",
                }}
                locales={locale}
              />
            </HStack>
          )}
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

export default SalesOrderSummary;
