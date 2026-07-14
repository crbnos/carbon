import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { Hidden, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Input,
  SidebarTrigger,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useInterval,
  VStack
} from "@carbon/react";
import { formatDurationMilliseconds } from "@carbon/utils";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toZoned
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { LuTimer } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import {
  batchCompleteValidator,
  toBatchCompleteMembers
} from "~/services/models";
import {
  getBatchProductionEvents,
  getJobOperationBatch,
  getJobOperationsByBatch
} from "~/services/operations.service";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});

  const { batchId } = params;
  if (!batchId) throw new Error("Batch ID is required");

  const serviceRole = await getCarbonServiceRole();

  const [batch, operations, events] = await Promise.all([
    getJobOperationBatch(serviceRole, batchId, companyId),
    getJobOperationsByBatch(serviceRole, batchId, companyId),
    getBatchProductionEvents(serviceRole, batchId, companyId)
  ]);

  if (batch.error || !batch.data) {
    throw redirect(
      path.to.operations,
      await flash(request, error(batch.error, "Failed to load batch"))
    );
  }

  if (operations.error) {
    throw redirect(
      path.to.operations,
      await flash(
        request,
        error(operations.error, "Failed to load batch operations")
      )
    );
  }

  if (events.error) {
    throw redirect(
      path.to.operations,
      await flash(
        request,
        error(events.error, "Failed to load batch production events")
      )
    );
  }

  const process = Array.isArray(batch.data.process)
    ? batch.data.process[0]
    : batch.data.process;
  const workCenter = Array.isArray(batch.data.workCenter)
    ? batch.data.workCenter[0]
    : batch.data.workCenter;

  const members = (operations.data ?? []).map((op) => {
    const job = Array.isArray(op.job) ? op.job[0] : op.job;
    return {
      id: op.id,
      description: op.description ?? "",
      operationQuantity: op.operationQuantity ?? 0,
      quantityComplete: op.quantityComplete ?? 0,
      status: op.status,
      jobReadableId: job?.jobId ?? "",
      itemReadableId: job?.itemReadableId ?? ""
    };
  });

  return {
    batch: {
      id: batch.data.id,
      readableId: batch.data.readableId,
      status: batch.data.status,
      workCenterId: batch.data.workCenterId,
      processName: process?.name ?? "",
      workCenterName: workCenter?.name ?? ""
    },
    members,
    events: events.data ?? []
  };
}

export default function BatchRoute() {
  const { batch, members, events } = useLoaderData<typeof loader>();
  const { t } = useLingui();

  const tz = getLocalTimeZone();

  // A batch timer is recorded once against the whole batch. A row with a
  // startTime and no endTime is the running timer.
  const openEvent = useMemo(
    () => events.find((e) => e.startTime && !e.endTime),
    [events]
  );
  const isRunning = !!openEvent;
  const isCompleted = batch.status === "Completed";
  // 'Completing' is an in-flight state: a prior completion committed the timer
  // slice but a post-commit effect (issue / Done / GL) failed. Timing is done, so
  // hide the Start/End timer, but keep the Complete form enabled so the operator
  // can retry — the edge function resumes the idempotent post-commit steps.
  const isCompleting = batch.status === "Completing";
  const canRunTimer = batch.status === "Active";

  const computeElapsed = useMemo(
    () => () => {
      let total = 0;
      for (const e of events) {
        if (e.endTime && e.duration) {
          total += e.duration * 1000;
        } else if (e.startTime && !e.endTime) {
          const start = toZoned(parseAbsolute(e.startTime, tz), tz);
          const diff = now(tz).compare(start);
          if (diff > 0) total += diff;
        }
      }
      return total;
    },
    [events, tz]
  );

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => setElapsed(computeElapsed()), [computeElapsed]);
  useInterval(() => setElapsed(computeElapsed()), isRunning ? 1000 : null);

  const startFetcher = useFetcher<{}>();
  const representativeId = members[0]?.id;

  return (
    <div className="flex flex-col h-screen w-[calc(100dvw-var(--sidebar-width-icon))] overflow-auto">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b bg-background">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">
            <Trans>Batch</Trans> {batch.readableId}
          </Heading>
          <Badge
            variant={
              isCompleted ? "green" : isCompleting ? "yellow" : "secondary"
            }
          >
            {batch.status}
          </Badge>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4 max-w-3xl w-full mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>
              {batch.processName}
              {batch.workCenterName ? ` — ${batch.workCenterName}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <HStack className="items-center gap-2">
                <LuTimer className="text-muted-foreground" />
                <span className="text-lg font-semibold tabular-nums">
                  {formatDurationMilliseconds(elapsed)}
                </span>
                {isRunning && (
                  <Badge variant="green">
                    <Trans>Running</Trans>
                  </Badge>
                )}
              </HStack>

              {canRunTimer && representativeId && (
                <startFetcher.Form method="post" action={path.to.batchEvent}>
                  <input
                    type="hidden"
                    name="jobOperationBatchId"
                    value={batch.id}
                  />
                  <input
                    type="hidden"
                    name="jobOperationId"
                    value={representativeId}
                  />
                  <input type="hidden" name="timezone" value={tz} />
                  <input type="hidden" name="type" value="Machine" />
                  <input
                    type="hidden"
                    name="action"
                    value={isRunning ? "End" : "Start"}
                  />
                  {isRunning && openEvent && (
                    <input type="hidden" name="id" value={openEvent.id} />
                  )}
                  {batch.workCenterId && (
                    <input
                      type="hidden"
                      name="workCenterId"
                      value={batch.workCenterId}
                    />
                  )}
                  <Button
                    type="submit"
                    size="lg"
                    variant={isRunning ? "destructive" : "primary"}
                    isDisabled={startFetcher.state !== "idle"}
                  >
                    {isRunning ? t`End Batch` : t`Start Batch`}
                  </Button>
                </startFetcher.Form>
              )}
            </HStack>
          </CardContent>
        </Card>

        <CompleteBatch
          batchId={batch.id}
          members={members}
          // Enabled while Active OR Completing (a retry resumes the post-commit
          // steps); only a terminal Completed/Cancelled batch disables it.
          disabled={isCompleted || batch.status === "Cancelled"}
          resuming={isCompleting}
        />
      </div>
    </div>
  );
}

type MemberRow = {
  jobOperationId: string;
  jobReadableId: string;
  itemReadableId: string;
  planned: number;
  quantity: number;
  scrapQuantity: number;
};

function CompleteBatch({
  batchId,
  members,
  disabled,
  resuming
}: {
  batchId: string;
  members: Awaited<ReturnType<typeof loader>>["members"];
  disabled: boolean;
  // The batch is 'Completing' — a prior attempt's post-commit step failed and
  // submitting resumes it rather than starting a fresh completion.
  resuming: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();

  const [rows, setRows] = useState<MemberRow[]>(() =>
    members.map((m) => ({
      jobOperationId: m.id,
      jobReadableId: m.jobReadableId,
      itemReadableId: m.itemReadableId,
      planned: m.operationQuantity,
      quantity: m.operationQuantity,
      scrapQuantity: 0
    }))
  );

  const updateRow = (index: number, patch: Partial<MemberRow>) =>
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );

  const serializedMembers = useMemo(
    () => JSON.stringify(toBatchCompleteMembers(rows)),
    [rows]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Complete Batch</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ValidatedForm
          method="post"
          action={path.to.batchComplete}
          validator={batchCompleteValidator}
          // `members` is submitted as a serialized JSON string via the Hidden
          // field below; the empty array only satisfies the inferred output type.
          defaultValues={{ jobOperationBatchId: batchId, members: [] }}
          fetcher={fetcher}
        >
          <Hidden name="jobOperationBatchId" value={batchId} />
          <Hidden name="members" value={serializedMembers} />
          <VStack spacing={4}>
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Job</Trans>
                  </Th>
                  <Th>
                    <Trans>Item</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Planned</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Quantity</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Scrap</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((row, index) => (
                  <Tr key={row.jobOperationId}>
                    <Td>{row.jobReadableId}</Td>
                    <Td>{row.itemReadableId}</Td>
                    <Td className="text-right tabular-nums">{row.planned}</Td>
                    <Td className="text-right">
                      <Input
                        type="number"
                        min={0}
                        className="w-24 ml-auto"
                        value={row.quantity}
                        isDisabled={disabled}
                        onChange={(e) =>
                          updateRow(index, {
                            quantity: Number(e.target.value)
                          })
                        }
                      />
                    </Td>
                    <Td className="text-right">
                      <Input
                        type="number"
                        min={0}
                        className="w-24 ml-auto"
                        value={row.scrapQuantity}
                        isDisabled={disabled}
                        onChange={(e) =>
                          updateRow(index, {
                            scrapQuantity: Number(e.target.value)
                          })
                        }
                      />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            <HStack className="justify-end w-full">
              <Button
                type="submit"
                size="lg"
                isDisabled={
                  disabled || fetcher.state !== "idle" || rows.length === 0
                }
              >
                {resuming ? t`Retry Completion` : t`Complete Batch`}
              </Button>
            </HStack>
          </VStack>
        </ValidatedForm>
      </CardContent>
    </Card>
  );
}
