import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Heading,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
} from "@carbon/react";
import { formatDate, getItemReadableId } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { Link, useParams } from "@remix-run/react";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { LuChevronRight, LuImage } from "react-icons/lu";
import { SupplierAvatar } from "~/components";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { useCurrencyFormatter, useRouteData, useUser } from "~/hooks";
import { useItems } from "~/stores";
import { getPrivateUrl, path } from "~/utils/path";
import type {
  PurchaseOrderLine,
  SupplierQuote,
  SupplierQuoteLine,
  SupplierQuoteLinePrice,
} from "../../types";

const LineItems = ({
  currencyCode,
  formatter,
  locale,
}: {
  currencyCode: string;
  formatter: Intl.NumberFormat;
  locale: string;
}) => {
  const { company } = useUser();
  const { id } = useParams();
  if (!id) throw new Error("Could not find quote id");

  const [items] = useItems();
  const routeData = useRouteData<{
    quote: SupplierQuote;
    lines: SupplierQuoteLine[];
    prices: SupplierQuoteLinePrice[];
  }>(path.to.supplierQuote(id));

  const [openItems, setOpenItems] = useState<string[]>(
    routeData?.lines.map((line) => line.id!) ?? []
  );

  const pricingByLine = useMemo(
    () =>
      routeData?.lines?.reduce<Record<string, SupplierQuoteLinePrice[]>>(
        (acc, line) => {
          if (!line.id) {
            return acc;
          }
          acc[line.id!] =
            routeData?.prices?.filter(
              (p) => p.supplierQuoteLineId === line.id
            ) ?? [];
          return acc;
        },
        {}
      ) ?? {},
    [routeData?.lines, routeData?.prices]
  );

  const toggleOpen = (id: string) => {
    setOpenItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const shouldConvertCurrency =
    routeData?.quote.currencyCode !== company?.baseCurrencyCode;

  return (
    <VStack spacing={8} className="w-full overflow-hidden">
      {routeData?.lines?.map((line) => {
        const prices = pricingByLine[line.id!];

        const itemReadableId = getItemReadableId(items, line.itemId);
        if (!line || !prices || !line.id) {
          return null;
        }

        return (
          <motion.div
            key={line.id}
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="py-6 w-full"
          >
            <HStack spacing={4} className="items-start">
              {line.thumbnailPath ? (
                <img
                  alt={itemReadableId!}
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
                  <div className="flex items-center gap-x-4 justify-between flex-grow">
                    <HStack spacing={2} className="min-w-0 flex-shrink">
                      <Heading className="truncate">{itemReadableId}</Heading>
                      <Button
                        asChild
                        variant="link"
                        size="sm"
                        className="text-muted-foreground flex-shrink-0"
                      >
                        <Link to={path.to.supplierQuoteLine(id, line.id!)}>
                          Edit
                        </Link>
                      </Button>
                    </HStack>
                    <HStack spacing={4}>
                      <motion.div
                        animate={{
                          rotate: openItems.includes(line.id) ? 90 : 0,
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
                collapsed: { opacity: 0, height: 0, marginTop: 0 },
              }}
              transition={{ duration: 0.3 }}
              className="w-full overflow-hidden"
            >
              <LinePricingOptions
                formatter={formatter}
                line={line}
                options={pricingByLine[line.id!]}
                quoteCurrency={routeData?.quote.currencyCode ?? "USD"}
                quoteExchangeRate={routeData?.quote.exchangeRate ?? 1}
                shouldConvertCurrency={shouldConvertCurrency}
                locale={locale}
              />
            </motion.div>
          </motion.div>
        );
      })}
    </VStack>
  );
};

type LinePricingOptionsProps = {
  line: SupplierQuoteLine;
  options: SupplierQuoteLinePrice[];
  quoteCurrency: string;
  shouldConvertCurrency: boolean;
  quoteExchangeRate: number;
  locale: string;
  formatter: Intl.NumberFormat;
};

const LinePricingOptions = ({
  line,
  options,
  locale,
  formatter,
}: LinePricingOptionsProps) => {
  const { id } = useParams();
  if (!id) throw new Error("Could not find quote id");
  const unitOfMeasures = useUnitOfMeasure();

  return (
    <VStack spacing={4} className="w-full">
      <Table>
        <Thead>
          <Tr>
            <Th>Quantity</Th>
            <Th>Unit Price</Th>
            <Th>Shipping</Th>
            <Th>Tax</Th>
            <Th>Lead Time</Th>

            <Th className="text-right">Total</Th>
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
            options.map(
              (option, index) =>
                (line?.quantity?.includes(option.quantity) ||
                  option.quantity === 0) && (
                  <Tr key={index}>
                    <Td>
                      <div className="flex items-center gap-x-2 justify-between">
                        <VStack spacing={0}>
                          <span>
                            {option.quantity}{" "}
                            {
                              unitOfMeasures.find(
                                (uom) =>
                                  uom.value === line.purchaseUnitOfMeasureCode
                              )?.label
                            }
                          </span>
                          {line.conversionFactor !== 1 && (
                            <span className="text-muted-foreground text-xs">
                              {option.quantity * (line.conversionFactor ?? 1)}{" "}
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
                      </div>
                    </Td>
                    <Td>
                      <VStack spacing={0}>
                        <span>{formatter.format(option.unitPrice ?? 0)}</span>
                        {line.conversionFactor !== 1 && (
                          <span className="text-muted-foreground text-xs">
                            {formatter.format(
                              (option.unitPrice ?? 0) /
                                (line.conversionFactor ?? 1)
                            )}
                          </span>
                        )}
                      </VStack>
                    </Td>

                    <Td>{formatter.format(option.shippingCost ?? 0)}</Td>
                    <Td>{formatter.format(option.taxAmount ?? 0)}</Td>

                    <Td>
                      {new Intl.NumberFormat(locale, {
                        style: "unit",
                        unit: "day",
                      }).format(option.leadTime)}
                    </Td>

                    <Td className="text-right">
                      {formatter.format(
                        (option.unitPrice ?? 0) * option.quantity +
                          (option.shippingCost ?? 0) +
                          (option.supplierTaxAmount ?? 0)
                      )}
                    </Td>
                  </Tr>
                )
            )
          )}
        </Tbody>
      </Table>
    </VStack>
  );
};

const SupplierQuoteSummary = () => {
  const { id } = useParams();
  if (!id) throw new Error("Could not find quote id");
  const routeData = useRouteData<{
    quote: SupplierQuote;
    lines: SupplierQuoteLine[];
    prices: SupplierQuoteLinePrice[];
    purchaseOrderLines: PurchaseOrderLine[];
  }>(path.to.supplierQuote(id));

  const { locale } = useLocale();
  const formatter = useCurrencyFormatter();

  return (
    <Card>
      <CardHeader>
        <HStack className="justify-between items-center">
          <div className="flex flex-col gap-1">
            <CardTitle>{routeData?.quote.supplierQuoteId}</CardTitle>
            <CardDescription>Supplier Quote</CardDescription>
          </div>
          <div className="flex flex-col gap-1 items-end">
            <SupplierAvatar supplierId={routeData?.quote.supplierId ?? null} />
            {routeData?.quote?.expirationDate && (
              <span className="text-muted-foreground text-sm">
                Expires {formatDate(routeData?.quote.expirationDate)}
              </span>
            )}
          </div>
        </HStack>
      </CardHeader>
      <CardContent>
        <LineItems
          currencyCode={routeData?.quote.currencyCode ?? "USD"}
          locale={locale}
          formatter={formatter}
        />
      </CardContent>
    </Card>
  );
};

export default SupplierQuoteSummary;
