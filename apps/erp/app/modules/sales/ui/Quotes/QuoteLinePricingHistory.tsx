import { Table, Tbody, Td, Tr } from "@carbon/react";
import { Link } from "@remix-run/react";
import { CustomerAvatar, Empty } from "~/components";
import { path } from "~/utils/path";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../../../../../packages/react/src/Card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "../../../../../../../packages/react/src/Carousel";
import { HStack } from "../../../../../../../packages/react/src/HStack";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../../../../../../packages/react/src/Tabs";
import { formatDate } from "../../../../../../../packages/utils/src/date";
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
  const historyCount = orderLineCount + quoteLineCount;

  return (
    <Card isCollapsible defaultCollapsed>
      <CardHeader className="p-3">
        <HStack>
          <CardTitle>History ({historyCount})</CardTitle>
        </HStack>
      </CardHeader>
      <CardContent className="p-3">
        <div className="w-full">
          <Tabs defaultValue="salesOrderLines">
            <TabsList>
              <TabsTrigger value="salesOrderLines">
                Orders ({orderLineCount})
              </TabsTrigger>
              <TabsTrigger value="quoteLines">
                Quotes ({quoteLineCount})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="salesOrderLines">
              <div className="flex overflow-x-auto space-x-4 pb-4">
                {relatedSalesOrderLines.length === 0 && (
                  <Empty className="py-6" />
                )}
                <Carousel className="w-full">
                  <CarouselContent className="-ml-4">
                    {relatedSalesOrderLines.map((line) => (
                      <CarouselItem
                        key={line.id}
                        className="pl-4 basis-full md:basis-1 lg:basis-1/2 xl:basis-1/3"
                      >
                        <Card className="w-full">
                          <CardContent className="p-4">
                            <HStack className="flex justify-between mb-2">
                              <Link
                                to={path.to.salesOrderLine(
                                  line.salesOrderId!,
                                  line.id!
                                )}
                                className="text-sm font-medium hover:underline"
                              >
                                {line.salesOrderReadableId}
                              </Link>
                              <div>
                                <span className="text-sm text-muted-foreground">
                                  {formatDate(line.orderDate!)}
                                </span>
                              </div>
                            </HStack>
                            <div className="space-y-4">
                              <div className="flex justify-between">
                                <span className="text-sm font-medium">
                                  <CustomerAvatar
                                    customerId={line.customerId}
                                  />
                                </span>
                              </div>

                              <Table>
                                <Tbody>
                                  <Tr>
                                    <Td>
                                      <span className="font-medium">
                                        Quantity
                                      </span>
                                    </Td>
                                    <Td>
                                      <span className="font-medium">
                                        Unit Price
                                      </span>
                                    </Td>
                                  </Tr>
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
                  <CarouselPrevious />
                  <CarouselNext />
                </Carousel>
              </div>
            </TabsContent>
            <TabsContent value="quoteLines">
              <div className="flex overflow-x-auto space-x-4 pb-4">
                {Object.keys(historicalQuoteLines).length === 0 && (
                  <Empty className="py-6" />
                )}
                <Carousel className="w-full">
                  <CarouselContent className="-ml-4">
                    {Object.values(historicalQuoteLines).map((line) => (
                      <CarouselItem
                        key={line.id}
                        className="pl-4 basis-full md:basis-1 lg:basis-1/2 xl:basis-1/3"
                      >
                        <Card className="w-full">
                          <CardContent className="p-4">
                            <HStack className="flex justify-between mb-2">
                              <Link
                                to={path.to.quoteLine(line.quoteId!, line.id!)}
                                className="text-sm font-medium hover:underline"
                              >
                                {line.quoteReadableId}
                              </Link>
                              <div>
                                <span className="text-sm text-muted-foreground">
                                  {formatDate(line.quoteCreatedAt!)}
                                </span>
                              </div>
                            </HStack>
                            <div className="space-y-4">
                              <div className="flex justify-between">
                                <span className="text-sm font-medium">
                                  <CustomerAvatar
                                    customerId={line.customerId}
                                  />
                                </span>
                              </div>

                              <Table>
                                <Tbody>
                                  <Tr>
                                    <Td>
                                      <span className="font-medium">
                                        Quantity
                                      </span>
                                    </Td>
                                    <Td>
                                      <span className="font-medium">
                                        Unit Price
                                      </span>
                                    </Td>
                                  </Tr>
                                  {Object.entries(line.quantities).map(
                                    ([quantity, price]) => (
                                      <Tr key={quantity}>
                                        <Td>{quantity}</Td>
                                        <Td>
                                          {new Intl.NumberFormat("en-US", {
                                            style: "currency",
                                            currency: baseCurrency,
                                          }).format(price)}
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
                  <CarouselPrevious />
                  <CarouselNext />
                </Carousel>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </CardContent>
    </Card>
  );
};

export default QuoteLinePricingHistory;
