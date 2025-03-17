import { Link } from "@remix-run/react";
import { useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import { CustomerAvatar, Empty } from "~/components";
import { path } from "~/utils/path";
import { Button } from "../../../../../../../packages/react/src/Button";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../../../../../packages/react/src/Collapsible";
import { HStack } from "../../../../../../../packages/react/src/HStack";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../../../../../../packages/react/src/Tabs";
import { cn } from "../../../../../../../packages/react/src/utils/cn";
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
  const [isOpen, setIsOpen] = useState(false);

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

  const historyCount =
    relatedSalesOrderLines.length + Object.keys(historicalQuoteLines).length;

  return (
    <div>
      <Card>
        <Collapsible>
          <CardHeader className="p-3">
            <HStack>
              <CardTitle>History ({historyCount})</CardTitle>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  <LuChevronDown
                    className={cn("h-4 w-4 transition-transform", {
                      "rotate-180": isOpen,
                    })}
                    onClick={() => setIsOpen(!isOpen)}
                  />
                  <span className="sr-only">Toggle history</span>
                </Button>
              </CollapsibleTrigger>
            </HStack>
          </CardHeader>
          <CardContent className="p-3">
            <CollapsibleContent>
              <div className="w-full">
                <Tabs defaultValue="salesOrderLines">
                  <TabsList>
                    <TabsTrigger value="salesOrderLines">Orders</TabsTrigger>
                    <TabsTrigger value="quoteLines">Quotes</TabsTrigger>
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
                              className="pl-4 basis-full md:basis-1/2 lg:basis-1/3"
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
                                        {new Date(
                                          line.orderDate!
                                        ).toLocaleDateString()}
                                      </span>
                                    </div>
                                  </HStack>
                                  <div className="space-y-2">
                                    <div className="flex justify-between">
                                      <span className="text-sm font-medium">
                                        <CustomerAvatar
                                          customerId={line.customerId}
                                        />
                                      </span>
                                    </div>

                                    <div className="grid grid-cols-2">
                                      <div className="text-sm font-medium border p-2">
                                        Quantity
                                      </div>
                                      <div className="text-sm font-medium border p-2">
                                        Unit Price
                                      </div>
                                      <div className="text-sm text-muted-foreground border p-2">
                                        {line.saleQuantity}
                                      </div>
                                      <div className="text-sm text-muted-foreground border p-2">
                                        {new Intl.NumberFormat("en-US", {
                                          style: "currency",
                                          currency: baseCurrency,
                                        }).format(line.unitPrice ?? 0)}
                                      </div>
                                    </div>
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
                              className="pl-4 basis-full md:basis-1/2 lg:basis-1/3"
                            >
                              <Card className="w-full">
                                <CardContent className="p-4">
                                  <HStack className="flex justify-between mb-2">
                                    <Link
                                      to={path.to.quoteLine(
                                        line.quoteId!,
                                        line.id!
                                      )}
                                      className="text-sm font-medium hover:underline"
                                    >
                                      {line.quoteReadableId}
                                    </Link>
                                    <div>
                                      <span className="text-sm text-muted-foreground">
                                        {new Date(
                                          line.quoteCreatedAt!
                                        ).toLocaleDateString()}
                                      </span>
                                    </div>
                                  </HStack>
                                  <div className="space-y-2">
                                    <div className="flex justify-between">
                                      <span className="text-sm font-medium">
                                        <CustomerAvatar
                                          customerId={line.customerId}
                                        />
                                      </span>
                                    </div>

                                    <div className="grid grid-cols-2">
                                      <div className="text-sm font-medium border p-2">
                                        Quantity
                                      </div>
                                      <div className="text-sm font-medium border p-2">
                                        Unit Price
                                      </div>
                                      {Object.entries(line.quantities).map(
                                        ([quantity, price]) => (
                                          <>
                                            <div className="text-sm text-muted-foreground border p-2">
                                              {quantity}
                                            </div>
                                            <div className="text-sm text-muted-foreground border p-2">
                                              {new Intl.NumberFormat("en-US", {
                                                style: "currency",
                                                currency: baseCurrency,
                                              }).format(price)}
                                            </div>
                                          </>
                                        )
                                      )}
                                    </div>
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
            </CollapsibleContent>
          </CardContent>
        </Collapsible>
      </Card>
    </div>
  );
};

export default QuoteLinePricingHistory;
