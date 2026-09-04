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
import {
  formatDate,
  formatExchangeRate,
  INPUT_FORMAT,
  INPUT_STEP
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { json2csv } from "json-2-csv";
import { useCallback, useMemo } from "react";
import { LuDownload } from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { z } from "zod";
import { DateTime } from "~/components";
import {
  CustomFormFields,
  Hidden,
  Input,
  Number as NumberField,
  Submit
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  currencyValidator,
  exchangeRateOverrideValidator
} from "../../accounting.models";
import ExchangeRateSourceBadge from "./ExchangeRateSourceBadge";

type ExchangeRateHistoryRow = {
  effectiveDate: string;
  rate: number;
};

type CurrencyFormProps = {
  initialValues: z.infer<typeof currencyValidator>;
  rate?: number | null;
  rateSource?: string | null;
  exchangeRateHistory?: ExchangeRateHistoryRow[];
};

const CONFIG_FORM_ID = "currency-config-form";

const CurrencyForm = ({
  initialValues,
  rate = null,
  rateSource = null,
  exchangeRateHistory = []
}: CurrencyFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);
  const { locale } = useLocale();
  const resetFetcher = useFetcher<{}>();

  const { company } = useUser();

  const isBaseCurrency = company?.baseCurrencyCode === initialValues.code;
  const exchangeRateHelperText = isBaseCurrency
    ? t`This is the base currency. Exchange rate is always 1.`
    : t`One ${company?.baseCurrencyCode} is equal to how many ${initialValues.code}?`;

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      rate: {
        label: t`Market rate (per USD)`,
        color: "hsl(var(--primary))"
      }
    }),
    [t]
  );

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

  const onResetToMarketRate = useCallback(() => {
    if (!initialValues.id || !initialValues.code) return;
    resetFetcher.submit(
      { intent: "reset", currencyCode: initialValues.code },
      { method: "post", action: path.to.exchangeRate(initialValues.id) }
    );
  }, [initialValues.code, initialValues.id, resetFetcher]);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <div className="flex flex-col h-full">
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? t`Edit Currency` : t`New Currency`}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            {isEditing && (
              <ValidatedForm
                validator={exchangeRateOverrideValidator}
                method="post"
                action={path.to.exchangeRate(initialValues.id!)}
                defaultValues={{
                  currencyCode: initialValues.code,
                  rate: rate ?? undefined
                }}
                className="w-full mb-6"
              >
                <Hidden name="intent" value="override" />
                <Hidden name="currencyCode" value={initialValues.code} />
                <VStack spacing={4}>
                  <NumberField
                    name="rate"
                    label={t`Exchange Rate`}
                    termId="exchange-rate"
                    minValue={0}
                    step={INPUT_STEP.exchangeRate}
                    formatOptions={INPUT_FORMAT.exchangeRate}
                    helperText={exchangeRateHelperText}
                    isDisabled={isBaseCurrency}
                  />
                  <HStack className="w-full justify-between">
                    <ExchangeRateSourceBadge source={rateSource} />
                    {!isBaseCurrency && (
                      <HStack>
                        {rateSource === "override" && (
                          <Button
                            type="button"
                            variant="secondary"
                            isDisabled={isDisabled}
                            isLoading={resetFetcher.state !== "idle"}
                            onClick={onResetToMarketRate}
                          >
                            {t`Reset to market rate`}
                          </Button>
                        )}
                        <Submit isDisabled={isDisabled}>{t`Save Rate`}</Submit>
                      </HStack>
                    )}
                  </HStack>
                </VStack>
              </ValidatedForm>
            )}

            <ValidatedForm
              id={CONFIG_FORM_ID}
              validator={currencyValidator}
              method="post"
              action={
                isEditing
                  ? path.to.exchangeRate(initialValues.id!)
                  : path.to.newExchangeRate
              }
              defaultValues={initialValues}
              className="w-full"
            >
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} isReadOnly />
                <Input name="code" label={t`Code`} isReadOnly />
                <NumberField
                  name="decimalPlaces"
                  label={t`Decimal Places`}
                  termId="decimal-places-currency"
                  minValue={0}
                  maxValue={4}
                />
                {!isBaseCurrency && (
                  <NumberField
                    name="historicalExchangeRate"
                    label={t`Historical Rate (Equity)`}
                    termId="historical-exchange-rate"
                    minValue={0}
                    step={INPUT_STEP.exchangeRate}
                    formatOptions={INPUT_FORMAT.exchangeRate}
                    helperText={t`Rate used for equity account translation in consolidation (IAS 21). Leave blank to use the current exchange rate.`}
                  />
                )}

                <CustomFormFields table="currency" />
              </VStack>
            </ValidatedForm>

            {isEditing && !isBaseCurrency && hasHistory && (
              <Tabs defaultValue="chart" className="mt-6 w-full">
                <Card className="w-full">
                  <HStack className="items-center justify-between">
                    <CardHeader>
                      <CardTitle>{t`Market Rate History (per USD)`}</CardTitle>
                    </CardHeader>
                    <CardAction>
                      <HStack>
                        <TabsList>
                          <TabsTrigger value="chart">{t`Chart`}</TabsTrigger>
                          <TabsTrigger value="table">{t`Table`}</TabsTrigger>
                        </TabsList>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <IconButton
                              aria-label={t`Download CSV`}
                              title={t`Download CSV`}
                              variant="ghost"
                              icon={<LuDownload />}
                              className="!border-dashed border-border"
                              onClick={onDownloadCSV}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t`Download CSV`}</p>
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
                              formatDate(v, {
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
                                  formatDate(v, {
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
                              <Th>{t`Date`}</Th>
                              <Th className="text-right">{t`Rate`}</Th>
                            </Tr>
                          </Thead>
                          <Tbody>
                            {[...chartData].reverse().map((row) => (
                              <Tr key={row.date}>
                                <Td>
                                  <DateTime value={row.date} variant="date" />
                                </Td>
                                <Td className="text-right">
                                  {formatExchangeRate(row.rate, locale)}
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
              <Submit formId={CONFIG_FORM_ID} isDisabled={isDisabled}>
                {t`Save`}
              </Submit>
              <Button variant="solid" onClick={onClose}>
                {t`Cancel`}
              </Button>
            </HStack>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default CurrencyForm;
