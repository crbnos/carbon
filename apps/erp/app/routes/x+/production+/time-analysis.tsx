// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Combobox,
  HStack,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { ChartContainer, ChartTooltip } from "@carbon/react/Chart";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis
} from "recharts";
import { z } from "zod";
import { DateTime } from "~/components";
import Empty from "~/components/Empty";
import { useUrlParams } from "~/hooks";
import {
  getOperationTimeDistributions,
  timeTypes
} from "~/modules/production/operation-time-analysis";
import {
  BoxPlot,
  formatSeconds
} from "~/modules/production/ui/TimeAnalysis/BoxPlot";
import { getDatabaseClient } from "~/services/database.server";
import { useItems } from "~/stores";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Time Analysis`,
  to: path.to.timeAnalysis
};

const ranges = ["90", "180", "365", "730"] as const;

const paramsValidator = z.object({
  itemId: z.string().optional(),
  operation: z.string().optional(),
  type: z.enum(timeTypes).catch("Labor"),
  days: z.enum(ranges).catch("365"),
  outliers: z.literal("1").optional().catch(undefined)
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "production"
  });
  const params = paramsValidator.parse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!params.itemId) {
    return {
      ...params,
      operations: [],
      versions: [],
      months: [],
      operators: []
    };
  }

  const db = getDatabaseClient();
  const distributions = (
    groupBy: "operation" | "version" | "month" | "operator"
  ) =>
    getOperationTimeDistributions(db, {
      companyId,
      itemId: params.itemId!,
      type: params.type,
      since: new Date(
        Date.now() - Number(params.days) * 86_400_000
      ).toISOString(),
      includeOutliers: params.outliers === "1",
      groupBy,
      operation: groupBy === "operation" ? undefined : params.operation
    });

  const [operations, versions, months, operators] = await Promise.all([
    distributions("operation"),
    ...(params.operation
      ? [
          distributions("version"),
          distributions("month"),
          distributions("operator")
        ]
      : [[], [], []])
  ]);

  return { ...params, operations, versions, months, operators };
}

export default function TimeAnalysisRoute() {
  const { t } = useLingui();
  const data = useLoaderData<typeof loader>();
  const [, setParams] = useUrlParams();
  const [items] = useItems();
  const selected = data.operations.find((o) => o.key === data.operation);
  const outliers = data.operations.flatMap((operation) =>
    operation.outliers.map((outlier) => ({ ...outlier, operation }))
  );

  const typeLabels = {
    Setup: t`Setup time per run`,
    Labor: t`Labor time per unit`,
    Machine: t`Machine time per unit`
  };
  const rangeLabels = {
    "90": t`Last 90 days`,
    "180": t`Last 6 months`,
    "365": t`Last 12 months`,
    "730": t`Last 2 years`
  };

  return (
    <VStack spacing={4} className="h-full w-full overflow-y-auto p-4">
      <HStack className="w-full flex-wrap">
        <div className="w-72">
          <Combobox
            size="sm"
            value={data.itemId}
            placeholder={t`Select an item`}
            options={items
              .filter((item) => item.replenishmentSystem !== "Buy")
              .map((item) => ({
                value: item.id,
                label: item.readableIdWithRevision,
                helper: item.name
              }))}
            onChange={(itemId) => setParams({ itemId, operation: undefined })}
          />
        </div>
        <Select value={data.type} onValueChange={(type) => setParams({ type })}>
          <SelectTrigger size="sm" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {typeLabels[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={data.days} onValueChange={(days) => setParams({ days })}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ranges.map((range) => (
              <SelectItem key={range} value={range}>
                {rangeLabels[range]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={data.outliers === "1"}
            onCheckedChange={(checked) =>
              setParams({ outliers: checked ? "1" : undefined })
            }
          />
          <Trans>Include outliers</Trans>
        </label>
      </HStack>

      {data.operations.length === 0 ? (
        <Empty>
          {data.itemId ? (
            <Trans>
              No finished operations with clocked time in this range
            </Trans>
          ) : (
            <Trans>Select an item to compare its operation times</Trans>
          )}
        </Empty>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Operation time overview</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  {typeLabels[data.type]}, with the number of runs (n) above
                  each operation. Select an operation to see how it changes.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BoxPlot
                data={data.operations}
                selected={data.operation}
                onSelect={(operation) =>
                  setParams({
                    operation:
                      operation === data.operation ? undefined : operation
                  })
                }
              />
            </CardContent>
          </Card>

          {selected && (
            <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Trans>{selected.label} by method version</Trans>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <BoxPlot data={data.versions} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Trans>{selected.label} over time</Trans>
                  </CardTitle>
                  <CardDescription>
                    <Trans>
                      Monthly median, with the middle half of runs shaded and
                      each new method version marked
                    </Trans>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{}}
                    className="aspect-auto h-72 w-full"
                  >
                    <ComposedChart
                      data={data.months.map((month) => ({
                        ...month,
                        middle: [month.q1, month.q3]
                      }))}
                      margin={{ top: 8, right: 8 }}
                    >
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={64}
                        tickFormatter={formatSeconds}
                      />
                      <ChartTooltip
                        formatter={(value) =>
                          [value]
                            .flat()
                            .map(Number)
                            .map(formatSeconds)
                            .join(" – ")
                        }
                      />
                      {data.months.map(
                        (month, i) =>
                          i > 0 &&
                          month.version > data.months[i - 1]!.version && (
                            <ReferenceLine
                              key={month.key}
                              x={month.label}
                              strokeDasharray="4 3"
                              label={{
                                value: `V${month.version}`,
                                position: "insideTopLeft"
                              }}
                            />
                          )
                      )}
                      <Area
                        dataKey="middle"
                        name={t`25th – 75th`}
                        stroke="none"
                        fill="hsl(var(--chart-1))"
                        fillOpacity={0.2}
                        isAnimationActive={false}
                      />
                      <Line
                        dataKey="median"
                        name={t`Median`}
                        stroke="hsl(var(--chart-1))"
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ChartContainer>
                </CardContent>
              </Card>
              <Card className="xl:col-span-2">
                <CardHeader>
                  <CardTitle>
                    <Trans>{selected.label} by operator</Trans>
                  </CardTitle>
                  <CardDescription>
                    <Trans>Runs shared between operators are left out</Trans>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <BoxPlot data={data.operators} />
                </CardContent>
              </Card>
            </div>
          )}

          {outliers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <Trans>Outliers</Trans>
                </CardTitle>
                <CardDescription>
                  <Trans>
                    Runs far outside the usual range for their operation. Open
                    the job's events to correct a wrong clock-in or clock-out.
                  </Trans>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <Thead>
                    <Tr>
                      <Th>
                        <Trans>Job</Trans>
                      </Th>
                      <Th>
                        <Trans>Operation</Trans>
                      </Th>
                      <Th>
                        <Trans>Time</Trans>
                      </Th>
                      <Th>
                        <Trans>Typical</Trans>
                      </Th>
                      <Th>
                        <Trans>Finished</Trans>
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {outliers.map((outlier, i) => (
                      <Tr key={i}>
                        <Td>
                          <Link
                            className="underline"
                            to={path.to.jobProductionEvents(outlier.jobId)}
                          >
                            {outlier.jobReadableId}
                          </Link>
                        </Td>
                        <Td>{outlier.operation.label}</Td>
                        <Td>{formatSeconds(outlier.seconds)}</Td>
                        <Td>{formatSeconds(outlier.operation.median)}</Td>
                        <Td>
                          <DateTime value={outlier.endedAt} variant="date" />
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </VStack>
  );
}
