import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@carbon/react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@carbon/react/Carousel";
import { Link } from "@remix-run/react";
import { Empty } from "~/components";
import { path } from "~/utils/path";

import { formatDate } from "@carbon/utils";
import { useCustomers } from "~/stores/customers";
import type { HistoricalQuotationPrice, SalesOrderLine } from "../../types";

const QuoteLinePricingHistory = ({
  baseCurrency,
  relatedSalesOrderLines,
  historicalQuoteLinePrices,
}: {
  baseCurrency: string;
  relatedSalesOrderLines: SalesOrderLine[];
  historicalQuoteLinePrices: HistoricalQuotationPrice[];
}) => {
  const historicalQuoteLines = historicalQuoteLinePrices.reduce<
    Record<
      string,
      HistoricalQuotationPrice & { quantities: Record<number, number> }
    >
  >((acc, linePrice) => {
    if (!acc[linePrice.id!]) {
      acc[linePrice.id!] = { ...linePrice, quantities: {} };
    }
    if (linePrice.qty && linePrice.unitPrice) {
      acc[linePrice.id!].quantities[linePrice.qty] = linePrice.unitPrice;
    }
    return acc;
  }, {});

  const orderLineCount = relatedSalesOrderLines.length;
  const quoteLineCount = Object.keys(historicalQuoteLines).length;

  const hasOrderLines = orderLineCount > 0;
  const hasQuoteLines = quoteLineCount > 0;
  const hasBothTypes = hasOrderLines && hasQuoteLines;

  // Default to the tab that has items
  const defaultTab = hasOrderLines ? "salesOrderLines" : "quoteLines";
  const [customers] = useCustomers();

  return (
    <Card isCollapsible defaultCollapsed>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>
          {orderLineCount > 0 || quoteLineCount > 0 ? (
            <span className="text-sm text-muted-foreground">
              {orderLineCount > 0 &&
                `${orderLineCount} order${orderLineCount !== 1 ? "s" : ""}`}
              {orderLineCount > 0 && quoteLineCount > 0 && " and "}
              {quoteLineCount > 0 &&
                `${quoteLineCount} quote${quoteLineCount !== 1 ? "s" : ""}`}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">
              No pricing history available
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="w-full">
          <Tabs defaultValue={defaultTab} className="w-full">
            {hasBothTypes && (
              <TabsList className="mb-4">
                <TabsTrigger value="salesOrderLines">Orders</TabsTrigger>
                <TabsTrigger value="quoteLines">Quotes</TabsTrigger>
              </TabsList>
            )}
            <TabsContent value="salesOrderLines">
              <div className="flex overflow-x-auto space-x-4 pb-4 w-full">
                {!hasOrderLines && <Empty className="py-6" />}
                {hasOrderLines && (
                  <Carousel className="w-full">
                    <CarouselContent className="-ml-4">
                      {relatedSalesOrderLines.map((line) => (
                        <CarouselItem
                          key={line.id}
                          className="pl-4 basis-full lg:basis-1/2"
                        >
                          <Card className="w-full p-0 bg-gradient-to-b from-card to-card via-card dark:from-card dark:to-card dark:via-card">
                            <CardContent className="p-4">
                              <HStack className="flex justify-between">
                                <div className="flex flex-col gap-1">
                                  <Link
                                    to={path.to.salesOrderLine(
                                      line.salesOrderId!,
                                      line.id!
                                    )}
                                    className="text-sm font-medium hover:underline"
                                  >
                                    {line.salesOrderReadableId}
                                  </Link>
                                  <span className="text-sm text-muted-foreground">
                                    {
                                      customers.find(
                                        (customer) =>
                                          customer.id === line.customerId
                                      )?.name
                                    }
                                  </span>
                                </div>
                                <div className="flex flex-col gap-1 items-end">
                                  <span className="text-xs text-muted-foreground">
                                    {formatDate(line.orderDate!)}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {line.itemReadableId}
                                  </span>
                                </div>
                              </HStack>
                              <div className="my-4">
                                <Table>
                                  <Thead>
                                    <Tr className="border-b border-border">
                                      <Th>
                                        <span className="font-medium">
                                          Quantity
                                        </span>
                                      </Th>
                                      <Th>
                                        <span className="font-medium">
                                          Price
                                        </span>
                                      </Th>
                                    </Tr>
                                  </Thead>
                                  <Tbody>
                                    <Tr>
                                      <Td>{line.saleQuantity}</Td>
                                      <Td>
                                        {new Intl.NumberFormat("en-US", {
                                          style: "currency",
                                          currency: baseCurrency,
                                        }).format(line.unitPrice ?? 0)}
                                      </Td>
                                    </Tr>
                                  </Tbody>
                                </Table>
                              </div>
                            </CardContent>
                          </Card>
                        </CarouselItem>
                      ))}
                    </CarouselContent>
                    {orderLineCount > 1 && (
                      <div className="flex justify-between mt-4">
                        <CarouselPrevious />
                        <CarouselNext />
                      </div>
                    )}
                  </Carousel>
                )}
              </div>
            </TabsContent>
            <TabsContent value="quoteLines">
              <div className="flex overflow-x-auto space-x-4 pb-4 w-full">
                {!hasQuoteLines && <Empty className="py-6" />}
                {hasQuoteLines && (
                  <Carousel className="w-full">
                    <CarouselContent className="-ml-4">
                      {Object.values(historicalQuoteLines).map((line) => (
                        <CarouselItem
                          key={line.id}
                          className="pl-4 basis-full lg:basis-1/2"
                        >
                          <Card className="w-full p-0 bg-gradient-to-b from-card to-card via-card dark:from-card dark:to-card dark:via-card">
                            <CardContent className="p-4">
                              <div className="flex flex-col gap-4">
                                <HStack className="flex justify-between">
                                  <div className="flex flex-col gap-1">
                                    <Link
                                      to={path.to.quoteLine(
                                        line.quoteId!,
                                        line.id!
                                      )}
                                      className="text-sm font-medium hover:underline"
                                    >
                                      {line.quoteReadableId}
                                    </Link>

                                    <span className="text-sm text-muted-foreground">
                                      {
                                        customers.find(
                                          (customer) =>
                                            customer.id === line.customerId
                                        )?.name
                                      }
                                    </span>
                                  </div>
                                  <div className="flex flex-col gap-1 items-end">
                                    <span className="text-xs text-muted-foreground">
                                      {formatDate(line.quoteCreatedAt!)}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {line.itemReadableId}
                                    </span>
                                  </div>
                                </HStack>
                              </div>

                              <div className="my-4">
                                <Table>
                                  <Thead>
                                    <Tr>
                                      <Th>
                                        <span className="font-medium">
                                          Quantity
                                        </span>
                                      </Th>
                                      <Th>
                                        <span className="font-medium">
                                          Price
                                        </span>
                                      </Th>
                                    </Tr>
                                  </Thead>
                                  <Tbody>
                                    {Object.entries(line.quantities).map(
                                      ([quantity, price]) => (
                                        <Tr key={quantity}>
                                          <Td>{quantity}</Td>
                                          <Td>
                                            {new Intl.NumberFormat("en-US", {
                                              style: "currency",
                                              currency: baseCurrency,
                                            }).format(price as number)}
                                          </Td>
                                        </Tr>
                                      )
                                    )}
                                  </Tbody>
                                </Table>
                              </div>
                            </CardContent>
                          </Card>
                        </CarouselItem>
                      ))}
                    </CarouselContent>
                    {quoteLineCount > 1 && (
                      <div className="flex justify-between mt-4">
                        <CarouselPrevious />
                        <CarouselNext />
                      </div>
                    )}
                  </Carousel>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </CardContent>
    </Card>
  );
};

export default QuoteLinePricingHistory;
