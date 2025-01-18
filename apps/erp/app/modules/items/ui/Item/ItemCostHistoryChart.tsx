import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
} from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@carbon/react/Chart";
import type { CalendarDate } from "@internationalized/date";
import { today } from "@internationalized/date";
import { useDateFormatter } from "@react-aria/i18n";
import { Link } from "@remix-run/react";
import { useMemo } from "react";
import { CSVLink } from "react-csv";
import {
  LuChartLine,
  LuEllipsisVertical,
  LuExternalLink,
  LuFile,
  LuInfo,
  LuTable,
} from "react-icons/lu";
import { Bar, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { SupplierAvatar } from "~/components";
import { useCurrencyFormatter } from "~/hooks";
import type { ItemCostHistory } from "~/modules/items";
import { useSuppliers } from "~/stores";
import { path } from "~/utils/path";
const chartConfig = {
  cost: {
    color: "hsl(var(--chart-1))",
    label: "Unit Cost",
  },
  weightedAverage: {
    color: "hsl(var(--chart-2))",
    label: "Weighted Average",
  },
} satisfies ChartConfig;

export function ItemCostHistoryChart({
  readableId,
  itemCostHistory,
}: {
  readableId: string;
  itemCostHistory: ItemCostHistory;
}) {
  const chartData = useMemo(() => {
    // Generate array of dates for the last year
    const todayDate = today("UTC");
    const oneYearAgo = todayDate.subtract({ years: 1 });

    // Create array of all dates in the last year
    const allDates: CalendarDate[] = [];
    let current = oneYearAgo;
    while (current.compare(todayDate) <= 0) {
      allDates.push(current);
      current = current.add({ days: 1 });
    }

    // Map cost history to dates, filling in gaps with null
    return allDates.map((date, index) => {
      const dateString = date.toString();
      let entries = itemCostHistory?.filter(
        (h) => h.postingDate === dateString
      );
      // If the first date is empty, fill it with the first item cost history entry
      if (
        index === 0 &&
        (entries === undefined || entries.length === 0) &&
        itemCostHistory?.[0]
      ) {
        entries = [
          itemCostHistory.find(
            (h) => new Date(h.postingDate) <= new Date(dateString)
          ) ?? itemCostHistory[0],
        ];
      }

      // If the last date is empty, fill it with the last item cost history entry
      if (
        index === allDates.length - 1 &&
        (entries === undefined || entries.length === 0) &&
        itemCostHistory?.[itemCostHistory.length - 1]
      ) {
        entries = [itemCostHistory[itemCostHistory.length - 1]];
      }

      const totalCost =
        entries?.reduce((sum, entry) => sum + entry.cost, 0) ?? 0;
      const totalQuantity =
        entries?.reduce((sum, entry) => sum + entry.quantity, 0) ?? 0;

      return {
        postingDate: dateString,
        cost: totalQuantity > 0 ? totalCost / totalQuantity : null,
        quantity: totalQuantity,
      };
    });
  }, [itemCostHistory]);

  const currencyFormatter = useCurrencyFormatter();
  const shortDateFormatter = useDateFormatter({
    month: "short",
    day: "numeric",
  });
  const longDateFormatter = useDateFormatter({
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // Calculate max value for y-axis
  const maxCost = Math.max(...chartData.map((d) => d.cost ?? 0));
  const yAxisMax = maxCost * 1.2;

  const [suppliers] = useSuppliers();

  const csvData = useMemo(() => {
    if (!itemCostHistory) return [];
    return [
      ["Posting Date", "Nominal Cost", "Actual Cost", "Quantity", "Supplier"],
      ...itemCostHistory.map((h) => [
        longDateFormatter.format(new Date(h.postingDate)),
        currencyFormatter.format(h.nominalCost / h.quantity),
        currencyFormatter.format(h.cost / h.quantity),
        h.quantity,
        suppliers.find((s) => s.id === h.supplierId)?.name,
      ]),
    ];
  }, [itemCostHistory, longDateFormatter, currencyFormatter, suppliers]);

  return (
    <Card>
      <Tabs defaultValue="chart">
        <HStack className="w-full justify-between">
          <CardHeader>
            <CardTitle>Purchase History</CardTitle>
            <CardDescription>Purchase cost over the last year</CardDescription>
          </CardHeader>
          <CardAction className="flex-row-reverse items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  variant="secondary"
                  icon={<LuEllipsisVertical />}
                  aria-label="More"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>
                  <CSVLink
                    data={csvData}
                    filename={`${readableId}-cost-history-${today.toString()}.csv`}
                    className="flex flex-row items-center gap-2"
                  >
                    <DropdownMenuIcon icon={<LuFile />} />
                    Export CSV
                  </CSVLink>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <TabsList>
              <TabsTrigger value="chart" className="p-2">
                <LuChartLine />
              </TabsTrigger>
              <TabsTrigger value="table" className="p-2">
                <LuTable />
              </TabsTrigger>
            </TabsList>
          </CardAction>
        </HStack>
        <CardContent>
          <TabsContent value="chart">
            <ChartContainer
              config={chartConfig}
              className="min-h-[40vh] h-[calc(100dvh-570px)] w-full"
            >
              <LineChart accessibilityLayer data={chartData}>
                <CartesianGrid vertical={false} />
                <YAxis
                  domain={[0, yAxisMax]}
                  tickLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  axisLine={false}
                  tickFormatter={(value: number) => {
                    return currencyFormatter.format(value);
                  }}
                />
                <XAxis
                  dataKey="postingDate"
                  tickLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  axisLine={false}
                  tickFormatter={(value) => {
                    if (!value) return "";
                    return shortDateFormatter.format(new Date(value as string));
                  }}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      labelFormatter={(value) =>
                        currencyFormatter.format(value as number)
                      }
                    />
                  }
                />
                <Line
                  dataKey="cost"
                  type="linear"
                  stroke="var(--color-cost)"
                  strokeWidth={2}
                  dot={{
                    fill: "var(--color-cost)",
                    r: 4,
                  }}
                  activeDot={{
                    r: 8,
                  }}
                  connectNulls
                />
                <Bar dataKey="cost" fill="var(--color-cost)" />
              </LineChart>
            </ChartContainer>
          </TabsContent>
          <TabsContent value="table">
            {itemCostHistory ? (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Posting Date</Th>
                    <Th>
                      <div className="flex flex-row items-center gap-2">
                        Nominal Cost{" "}
                        <Tooltip>
                          <TooltipTrigger>
                            <LuInfo />
                          </TooltipTrigger>
                          <TooltipContent>
                            The unit price of the item at the time of the
                            purchase
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </Th>
                    <Th>
                      <div className="flex flex-row items-center gap-2">
                        Actual Cost{" "}
                        <Tooltip>
                          <TooltipTrigger>
                            <LuInfo />
                          </TooltipTrigger>
                          <TooltipContent>
                            Includes tax and shipping costs
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </Th>
                    <Th>Quantity</Th>
                    <Th>Supplier</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {itemCostHistory.map((h) => {
                    const unitCost = h.quantity > 0 ? h.cost / h.quantity : 0;
                    const nominalUnitCost = h.nominalCost / h.quantity;
                    return (
                      <Tr key={h.id}>
                        <Td>
                          <div className="flex flex-row items-center gap-2">
                            {longDateFormatter.format(new Date(h.postingDate))}
                            {h.documentId &&
                              h.documentType === "Purchase Invoice" && (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Button variant="link" size="sm" asChild>
                                      <Link
                                        to={path.to.purchaseInvoice(
                                          h.documentId
                                        )}
                                      >
                                        <LuExternalLink />
                                      </Link>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    View Purchase Invoice
                                  </TooltipContent>
                                </Tooltip>
                              )}
                          </div>
                        </Td>
                        <Td>{currencyFormatter.format(nominalUnitCost)}</Td>
                        <Td>{currencyFormatter.format(unitCost)}</Td>
                        <Td>{h.quantity}</Td>
                        <Td>
                          <SupplierAvatar supplierId={h.supplierId} />
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            ) : (
              <div className="flex flex-col items-center justify-center h-full">
                <p>No cost history found</p>
              </div>
            )}
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
