import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
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
  VStack
} from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@carbon/react/Chart";
import { useLingui } from "@lingui/react/macro";
import { json2csv } from "json-2-csv";
import { useCallback, useMemo, useState } from "react";
import { LuDownload } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  Number as NumberField,
  Submit
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { currencyValidator } from "../../accounting.models";

type ExchangeRateHistoryRow = {
  effectiveDate: string;
  rate: number;
};

type CurrencyFormProps = {
  initialValues: z.infer<typeof currencyValidator>;
  exchangeRateHistory?: ExchangeRateHistoryRow[];
};

const chartConfig = {
  rate: {
    label: "Exchange Rate",
    color: "hsl(var(--primary))"
  }
} satisfies ChartConfig;

const CurrencyForm = ({
  initialValues,
  exchangeRateHistory = []
}: CurrencyFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);
  const [decimalPlaces, setDecimalPlaces] = useState(
    initialValues.decimalPlaces ?? 2
  );

  const { company } = useUser();

  const isBaseCurrency = company?.baseCurrencyCode === initialValues.code;
  const exchangeRateHelperText = isBaseCurrency
    ? "This is the base currency. Exchange rate is always 1."
    : `One ${company?.baseCurrencyCode} is equal to how many ${initialValues.code}?`;

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const chartData = useMemo(
    () =>
      exchangeRateHistory.map((row) => ({
        date: row.effectiveDate,
        rate: Number(row.rate)
      })),
    [exchangeRateHistory]
  );

  const hasHistory = chartData.length > 0;

  const onDownloadCSV = useCallback(() => {
    if (!exchangeRateHistory.length) return;
    const csvData = json2csv(exchangeRateHistory);
    const blob = new Blob([csvData], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${initialValues.code}-exchange-rates.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, [exchangeRateHistory, initialValues.code]);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={currencyValidator}
          method="post"
          action={
            isEditing
              ? path.to.exchangeRate(initialValues.id!)
              : path.to.newExchangeRate
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>{isEditing ? "Edit" : "New"} Currency</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input name="name" label="Name" isReadOnly />
              <Input name="code" label="Code" isReadOnly />
              <NumberField
                name="decimalPlaces"
                label={t`Decimal Places`}
                termId="decimal-places-currency"
                minValue={0}
                maxValue={4}
                onChange={setDecimalPlaces}
              />
              <NumberField
                name="exchangeRate"
                label={t`Exchange Rate`}
                termId="exchange-rate"
                minValue={isBaseCurrency ? 1 : 0}
                maxValue={isBaseCurrency ? 1 : undefined}
                formatOptions={{
                  minimumFractionDigits: decimalPlaces ?? 0
                }}
                helperText={exchangeRateHelperText}
              />
              {!isBaseCurrency && (
                <NumberField
                  name="historicalExchangeRate"
                  label={t`Historical Rate (Equity)`}
                  termId="historical-exchange-rate"
                  minValue={0}
                  formatOptions={{
                    minimumFractionDigits: decimalPlaces ?? 0
                  }}
                  helperText="Rate used for equity account translation in consolidation (IAS 21). Leave blank to use the current exchange rate."
                />
              )}

              <CustomFormFields table="currency" />
            </VStack>

            {isEditing && !isBaseCurrency && hasHistory && (
              <Tabs defaultValue="chart" className="mt-6 w-full">
                <Card className="w-full">
                  <HStack className="items-center justify-between">
                    <CardHeader>
                      <CardTitle>Exchange Rate History</CardTitle>
                    </CardHeader>
                    <CardAction>
                      <HStack>
                        <TabsList>
                          <TabsTrigger value="chart">Chart</TabsTrigger>
                          <TabsTrigger value="table">Table</TabsTrigger>
                        </TabsList>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <IconButton
                              aria-label="Download CSV"
                              title="Download CSV"
                              variant="ghost"
                              icon={<LuDownload />}
                              className="!border-dashed border-border"
                              onClick={onDownloadCSV}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Download CSV</p>
                          </TooltipContent>
                        </Tooltip>
                      </HStack>
                    </CardAction>
                  </HStack>
                  <CardContent>
                    <TabsContent value="chart">
                      <ChartContainer
                        config={chartConfig}
                        className="h-[200px] w-full"
                      >
                        <AreaChart data={chartData}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(v) =>
                              new Date(v).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric"
                              })
                            }
                            tickLine={false}
                            axisLine={false}
                            fontSize={12}
                          />
                          <YAxis
                            domain={[0, "auto"]}
                            tickLine={false}
                            axisLine={false}
                            fontSize={12}
                          />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                labelFormatter={(v) =>
                                  new Date(v).toLocaleDateString(undefined, {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric"
                                  })
                                }
                              />
                            }
                          />
                          <Area
                            type="monotone"
                            dataKey="rate"
                            stroke="var(--color-rate)"
                            fill="var(--color-rate)"
                            fillOpacity={0.1}
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ChartContainer>
                    </TabsContent>
                    <TabsContent value="table">
                      <div className="max-h-[200px] overflow-y-auto">
                        <Table>
                          <Thead>
                            <Tr>
                              <Th>Date</Th>
                              <Th className="text-right">Rate</Th>
                            </Tr>
                          </Thead>
                          <Tbody>
                            {[...chartData].reverse().map((row) => (
                              <Tr key={row.date}>
                                <Td>
                                  {new Date(row.date).toLocaleDateString(
                                    undefined,
                                    {
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric"
                                    }
                                  )}
                                </Td>
                                <Td className="text-right">
                                  {row.rate.toFixed(decimalPlaces)}
                                </Td>
                              </Tr>
                            ))}
                          </Tbody>
                        </Table>
                      </div>
                    </TabsContent>
                  </CardContent>
                </Card>
              </Tabs>
            )}
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
              <Button variant="solid" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default CurrencyForm;
