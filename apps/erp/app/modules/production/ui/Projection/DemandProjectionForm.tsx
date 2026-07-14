import { ValidatedForm } from "@carbon/form";
import {
  CardDescription,
  CardTitle,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  HStack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
import type { ChartConfig } from "@carbon/react/Chart";
import { ChartContainer, ChartTooltip } from "@carbon/react/Chart";
import { getLocalTimeZone, startOfWeek, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis
} from "recharts";
import type { z } from "zod";
import { Hidden, Item, Location, Number, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { demandProjectionValidator } from "../../production.models";

type LoaderData = {
  periods?: Array<{ id: string; name: string }>;
  initialValues?: z.infer<typeof demandProjectionValidator>;
};

type DemandProjectionsFormProps = {
  initialValues?: z.infer<typeof demandProjectionValidator>;
  isEditing?: boolean;
  onClose: () => void;
};

const WEEK_COUNT = 52;
const QUARTERS = [
  { value: "q1", start: 0, end: 13 },
  { value: "q2", start: 13, end: 26 },
  { value: "q3", start: 26, end: 39 },
  { value: "q4", start: 39, end: 52 }
] as const;

// Coerce the react-aria onChange value (or an initialValues entry) to a finite
// number. NOTE: the imported `Number` form component SHADOWS the global Number
// in this file, so we use parseFloat / isFinite / unary + instead of Number().
const toFinite = (value: unknown): number => {
  if (typeof value === "number") return isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value ?? ""));
  return isFinite(parsed) ? parsed : 0;
};

const DemandProjectionsForm = ({
  initialValues: propInitialValues,
  isEditing = false,
  onClose
}: DemandProjectionsFormProps) => {
  const permissions = usePermissions();
  const { t, i18n } = useLingui();
  const numberFormatter = useNumberFormatter();
  const fetcher = useFetcher<{ id: string }>();
  const loaderData = useLoaderData<LoaderData>();
  const periods = loaderData?.periods ?? [];
  const initialValues = loaderData?.initialValues ??
    propInitialValues ?? {
      itemId: "",
      locationId: "",
      ...Object.fromEntries(
        Array.from({ length: WEEK_COUNT }, (_, i) => [`week${i}`, 0])
      )
    };

  const isDisabled = isEditing
    ? !permissions.can("update", "production")
    : !permissions.can("create", "production");

  const timeZone = getLocalTimeZone();
  const startDate = startOfWeek(today(timeZone), "en-US");
  const weekLabels = Array.from({ length: WEEK_COUNT }, (_, i) => {
    const weekDate = startDate.add({ weeks: i }).toDate(timeZone);
    const formattedDate = i18n.date(weekDate, {
      month: "numeric",
      day: "numeric"
    });
    return i18n._(msg`Week ${i + 1} (${formattedDate})`);
  });

  // Local mirror of the 52 week inputs, seeded from initialValues, that drives
  // the summary chart. The Number inputs remain the source of truth for submit;
  // this state exists only for visualization.
  const [weekValues, setWeekValues] = useState<number[]>(() =>
    Array.from({ length: WEEK_COUNT }, (_, i) =>
      toFinite((initialValues as Record<string, unknown>)[`week${i}`])
    )
  );

  // Re-seed the chart when the drawer is reused for a different projection
  // (same route, new item/location) — otherwise it keeps the prior values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setWeekValues(
      Array.from({ length: WEEK_COUNT }, (_, i) =>
        toFinite((initialValues as Record<string, unknown>)[`week${i}`])
      )
    );
  }, [initialValues.itemId, initialValues.locationId]);

  const handleWeekChange = (index: number, value: number) => {
    setWeekValues((prev) => {
      const next = [...prev];
      next[index] = isFinite(value) ? value : 0;
      return next;
    });
  };

  // Per-week demand plus a running/cumulative total, so the chart shows both the
  // shape of demand and the total committed across the horizon.
  let cumulative = 0;
  const chartData = weekValues.map((demand, i) => {
    cumulative += demand;
    return {
      week: i + 1,
      demand,
      cumulative
    };
  });

  const chartConfig: ChartConfig = {
    demand: { label: t`Weekly demand`, color: "hsl(var(--primary))" },
    cumulative: {
      label: t`Cumulative`,
      color: "hsl(var(--muted-foreground))"
    }
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={demandProjectionValidator}
          method="post"
          action={
            isEditing
              ? path.to.demandProjection(
                  initialValues.itemId!,
                  initialValues.locationId!
                )
              : path.to.newDemandProjection
          }
          defaultValues={initialValues}
          fetcher={fetcher}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <CardTitle>
              {isEditing
                ? t`Edit Production Projection`
                : t`New Production Projection`}
            </CardTitle>
            <CardDescription>
              {t`Set demand projection values for each week`}
            </CardDescription>
          </DrawerHeader>
          <DrawerBody>
            <div>
              {/* Hidden fields for periods */}
              {periods?.map((period, index) => (
                <Hidden
                  key={period.id}
                  name={`periods[${index}]`}
                  value={period.id}
                />
              ))}
            </div>
            <VStack spacing={4}>
              <Item
                name="itemId"
                label={t`Item`}
                type="Part"
                replenishmentSystem="Make"
                isReadOnly={isEditing}
                locationId={initialValues.locationId || undefined}
              />
              <Location
                name="locationId"
                label={t`Location`}
                isReadOnly={isEditing}
              />

              {/* Summary chart: weekly demand bars + cumulative total line. */}
              <div className="w-full">
                <div className="text-sm font-medium mb-2">
                  {t`52-week demand`}
                </div>
                <ChartContainer
                  config={chartConfig}
                  className="w-full h-[180px]"
                >
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="week"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={16}
                      tickFormatter={(value) => `${value}`}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={40}
                      allowDecimals={false}
                    />
                    <ChartTooltip
                      cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                      content={
                        <DemandChartTooltip formatter={numberFormatter} />
                      }
                    />
                    <Bar
                      dataKey="demand"
                      fill="hsl(var(--primary))"
                      fillOpacity={0.6}
                      radius={[2, 2, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="cumulative"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ChartContainer>
              </div>

              {/* Quarter tabs. ALL 52 week inputs stay mounted (forceMount +
                  hidden-when-inactive) so ValidatedForm still serializes every
                  week{i} field regardless of the active tab. */}
              <Tabs defaultValue="q1" className="w-full">
                <TabsList className="w-full">
                  {QUARTERS.map((quarter) => (
                    <TabsTrigger
                      key={quarter.value}
                      value={quarter.value}
                      className="flex-1"
                    >
                      {t`Wk ${quarter.start + 1}–${quarter.end}`}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {QUARTERS.map((quarter) => (
                  <TabsContent
                    key={quarter.value}
                    value={quarter.value}
                    forceMount
                    className="data-[state=inactive]:hidden pt-4"
                  >
                    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                      {Array.from(
                        { length: quarter.end - quarter.start },
                        (_, offset) => {
                          const index = quarter.start + offset;
                          return (
                            <Number
                              key={index}
                              name={`week${index}`}
                              label={weekLabels[index]}
                              minValue={0}
                              onChange={(value) =>
                                handleWeekChange(index, value)
                              }
                            />
                          );
                        }
                      )}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </VStack>
          </DrawerBody>

          <DrawerFooter>
            <HStack className="justify-end">
              <Submit
                isLoading={fetcher.state !== "idle"}
                isDisabled={fetcher.state !== "idle" || isDisabled}
              >
                {isEditing ? t`Update Projection` : t`Create Projection`}
              </Submit>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

function DemandChartTooltip({
  active,
  payload,
  formatter
}: {
  active?: boolean;
  payload?: Array<{
    payload: { week: number; demand: number; cumulative: number };
  }>;
  formatter: Intl.NumberFormat;
}) {
  const { t } = useLingui();
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="min-w-[10rem] rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
      <div className="font-medium mb-1.5">{t`Week ${d.week}`}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">{t`Weekly demand`}</span>
        <span className="tabular-nums">{formatter.format(d.demand)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">{t`Cumulative`}</span>
        <span className="tabular-nums">{formatter.format(d.cumulative)}</span>
      </div>
    </div>
  );
}

export default DemandProjectionsForm;
