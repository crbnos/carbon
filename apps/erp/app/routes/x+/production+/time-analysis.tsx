// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ClientOnly,
  Combobox,
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
import { now, parseAbsolute } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { z } from "zod";
import { DateTime } from "~/components";
import Empty from "~/components/Empty";
import { useUrlParams } from "~/hooks";
import {
  getOperationRuns,
  getOperationTimeDistributions,
  RUN_LIMIT,
  timeTypes
} from "~/modules/production/operation-time-analysis";
import {
  BoxPlot,
  formatSeconds,
  seriesColor
} from "~/modules/production/ui/TimeAnalysis/BoxPlot";
import { DateTimeRange } from "~/modules/production/ui/TimeAnalysis/DateTimeRange";
import {
  RunHistogram,
  RunScatter
} from "~/modules/production/ui/TimeAnalysis/RunCharts";
import { getDatabaseClient } from "~/services/database.server";
import { useItems } from "~/stores";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Time Analysis`,
  to: path.to.timeAnalysis
};

const paramsValidator = z.object({
  itemId: z.string().optional(),
  operation: z.string().optional(),
  type: z.enum(timeTypes).catch("Labor"),
  from: z.string().datetime().optional().catch(undefined),
  to: z.string().datetime().optional().catch(undefined),
  outliers: z.literal("1").optional().catch(undefined)
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await authorize(request, {
    "production.jobs": "View"
  });
  const params = paramsValidator.parse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  // Without a range: the twelve months up to now.
  const end = parseAbsolute(params.to ?? now("UTC").toAbsoluteString(), "UTC");
  const to = end.toAbsoluteString();
  const from = params.from ?? end.subtract({ years: 1 }).toAbsoluteString();
  const { itemId, operation } = params;
  if (!itemId) {
    return {
      ...params,
      from,
      to,
      operations: [],
      versions: [],
      operators: [],
      runs: []
    };
  }

  const db = getDatabaseClient();
  const filter = {
    companyId,
    itemId,
    type: params.type,
    from,
    to,
    includeOutliers: params.outliers === "1"
  };
  const [distributions, runs] = await Promise.all([
    getOperationTimeDistributions(db, { ...filter, operation }),
    operation ? getOperationRuns(db, { ...filter, operation }) : []
  ]);

  return { ...params, from, to, ...distributions, runs };
}

export default function TimeAnalysisRoute() {
  const { t } = useLingui();
  const data = useLoaderData<typeof loader>();
  const [search, setParams] = useUrlParams();
  const [items] = useItems();
  const selectedIndex = data.operations.findIndex(
    (o) => o.key === data.operation
  );
  const selected = data.operations[selectedIndex];
  const color = seriesColor(selectedIndex);
  const outliers = data.operations.flatMap((operation) =>
    operation.outliers.map((outlier) => ({ ...outlier, operation }))
  );

  const typeLabels = {
    Setup: t`Setup time per run`,
    Labor: t`Labor time per unit`,
    Machine: t`Machine time per unit`
  };
  return (
    <VStack spacing={4} className="h-full w-full overflow-y-auto p-4">
      <div className="flex w-full flex-wrap items-center gap-2">
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
        {/* The picker's markup differs between server and browser. */}
        <ClientOnly fallback={<div className="h-8 w-[31rem]" />}>
          {() => (
            <DateTimeRange
              // Remounted when the applied range changes, not when "now" moves.
              key={`${search.get("from")}|${search.get("to")}`}
              from={data.from}
              to={data.to}
              onChange={setParams}
            />
          )}
        </ClientOnly>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={data.outliers === "1"}
            onCheckedChange={(checked) =>
              setParams({ outliers: checked ? "1" : undefined })
            }
          />
          <Trans>Include outliers</Trans>
        </label>
      </div>

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
                selected={selected?.key}
                onSelect={(operation) =>
                  setParams({
                    operation:
                      operation === selected?.key ? undefined : operation
                  })
                }
              />
            </CardContent>
          </Card>

          {selected && (
            <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-2">
              <Card className="xl:col-span-2">
                <CardHeader>
                  <CardTitle>
                    <Trans>{selected.label} runs over time</Trans>
                  </CardTitle>
                  <CardDescription>
                    <Trans>
                      Each point is one run. The dotted lines are the average of
                      each method version across the runs made with it.
                    </Trans>{" "}
                    {data.runs.length === RUN_LIMIT && (
                      <Trans>
                        Only the latest {RUN_LIMIT} runs are plotted.
                      </Trans>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RunScatter
                    runs={data.runs}
                    versions={data.versions}
                    from={data.from}
                    to={data.to}
                    color={color}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Trans>{selected.label} distribution</Trans>
                  </CardTitle>
                  <CardDescription>
                    <Trans>
                      Number of runs by time taken. Average{" "}
                      {formatSeconds(selected.mean)}, median{" "}
                      {formatSeconds(selected.median)}.
                    </Trans>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RunHistogram
                    runs={data.runs}
                    mean={selected.mean}
                    color={color}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Trans>{selected.label} by method version</Trans>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <BoxPlot data={data.versions} color={color} />
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
                  {data.operators.length > 0 ? (
                    <BoxPlot data={data.operators} color={color} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <Trans>
                        No run in this range was worked by one operator alone
                      </Trans>
                    </p>
                  )}
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
