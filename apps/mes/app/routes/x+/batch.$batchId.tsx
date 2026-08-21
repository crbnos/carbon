import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { Hidden, NumberControlled, Submit, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  SidebarTrigger,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { datetime, formatDurationMilliseconds } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import {
  LuChevronLeft,
  LuCircleStop,
  LuFactory,
  LuLayers,
  LuPlay,
  LuTimer
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate
} from "react-router";
import type { z } from "zod";
import {
  Controls,
  IconButtonWithTooltip,
  WorkTypeToggle
} from "~/components/JobOperation/components/Controls";
import { completeJobOperationBatchValidator } from "~/services/models";
import {
  getJobOperationBatch,
  startProductionEvent
} from "~/services/operations.service";
import type { OperationWithDetails } from "~/services/types";
import { makeDurations } from "~/utils/durations";
import { path } from "~/utils/path";

const PRODUCTION_EVENT_TYPES = ["Setup", "Labor", "Machine"] as const;
type ProductionEventType = (typeof PRODUCTION_EVENT_TYPES)[number];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });
  const { batchId } = params;
  if (!batchId) throw new Error("Batch ID is required");

  const batch = await getJobOperationBatch(client, batchId, companyId);
  if (batch.error || !batch.data) {
    throw redirect(
      path.to.operations,
      await flash(request, error(batch.error, "Failed to load batch"))
    );
  }

  const hasOpenEvent = (batch.data.events ?? []).some((e) => !e.endTime);
  return { batch: batch.data, hasOpenEvent };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "production"
  });
  const { batchId } = params;
  if (!batchId) throw new Error("Batch ID is required");

  const formData = await request.formData();
  const intent = formData.get("intent");
  const serviceRole = await getCarbonServiceRole();

  const batch = await getJobOperationBatch(serviceRole, batchId, companyId);
  if (batch.error || !batch.data) {
    return data(
      {},
      await flash(request, error(batch.error, "Failed to load batch"))
    );
  }
  const firstMember = batch.data.operations?.[0];
  if (!firstMember) {
    return data({}, await flash(request, error(null, "Batch has no members")));
  }

  if (intent === "start") {
    const requestedType = String(formData.get("type") ?? "Machine");
    const type = (PRODUCTION_EVENT_TYPES as readonly string[]).includes(
      requestedType
    )
      ? (requestedType as ProductionEventType)
      : "Machine";
    const startEvent = await startProductionEvent(
      serviceRole,
      {
        type,
        jobOperationId: firstMember.id,
        workCenterId: (batch.data.workCenterId ??
          firstMember.workCenterId) as string,
        startTime: datetime.timestamp(),
        employeeId: userId,
        companyId,
        createdBy: userId,
        jobOperationBatchId: batchId
      },
      undefined
    );
    if (startEvent.error) {
      return data(
        {},
        await flash(request, error(startEvent.error, "Failed to start batch"))
      );
    }
    return data({ success: true });
  }

  if (intent === "stop") {
    const stop = await serviceRole
      .from("productionEvent")
      .update({
        endTime: datetime.timestamp(),
        updatedBy: userId
      })
      .eq("jobOperationBatchId", batchId)
      .is("endTime", null);
    if (stop.error) {
      return data(
        {},
        await flash(request, error(stop.error, "Failed to stop batch"))
      );
    }
    return data({ success: true });
  }

  return data({}, await flash(request, error(null, "Invalid intent")));
}

export default function BatchRoute() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const timerFetcher = useFetcher();
  const { batch, hasOpenEvent } = useLoaderData<typeof loader>();
  const members = batch.operations ?? [];
  const totalQuantity = members.reduce(
    (sum, m) => sum + (m.operationQuantity ?? 0),
    0
  );

  const status = (batch as { status?: string }).status ?? "Active";
  const isCompleted = status === "Completed";
  // 'Completing' is an in-flight state: a prior completion committed the slice but
  // a post-commit step (issue / Done / GL) failed. Hide the Start/End timer, but
  // keep the Complete form enabled so the operator can retry (it resumes).
  const isCompleting = status === "Completing";
  const canRunTimer = status === "Active";
  const completeDisabled = isCompleted;

  // The shared run's planned durations = sum of member durations; drives the
  // same Setup/Labor/Machine toggle the single-operation view uses.
  const summedDurations = members.reduce(
    (acc, m) => {
      try {
        const d = makeDurations({
          setupTime: m.setupTime ?? 0,
          setupUnit: (m.setupUnit ?? "Total Minutes") as string,
          laborTime: m.laborTime ?? 0,
          laborUnit: (m.laborUnit ?? "Minutes/Piece") as string,
          machineTime: m.machineTime ?? 0,
          machineUnit: (m.machineUnit ?? "Minutes/Piece") as string,
          operationQuantity: m.operationQuantity
        });
        acc.setupDuration += d.setupDuration;
        acc.laborDuration += d.laborDuration;
        acc.machineDuration += d.machineDuration;
      } catch {
        // A member without times contributes nothing.
      }
      return acc;
    },
    { setupDuration: 0, laborDuration: 0, machineDuration: 0 }
  );
  // No planned times anywhere → still allow a Machine timer.
  if (
    summedDurations.setupDuration === 0 &&
    summedDurations.laborDuration === 0 &&
    summedDurations.machineDuration === 0
  ) {
    summedDurations.machineDuration = 1;
  }

  const openEvents = (batch.events ?? []).filter((e) => !e.endTime);
  const activeByType = {
    setup: openEvents.some((e) => e.type === "Setup"),
    labor: openEvents.some((e) => e.type === "Labor"),
    machine: openEvents.some((e) => e.type === "Machine")
  };
  const [eventType, setEventType] = useState<string>(() => {
    if (activeByType.setup) return "Setup";
    if (activeByType.labor) return "Labor";
    if (summedDurations.setupDuration > 0 && !hasOpenEvent) return "Setup";
    if (summedDurations.machineDuration > 0) return "Machine";
    if (summedDurations.laborDuration > 0) return "Labor";
    return "Setup";
  });

  // Live batch elapsed: sum every recorded window; the open (running) one ticks
  // to the current time.
  const computeElapsed = useCallback(() => {
    let ms = 0;
    for (const e of batch.events ?? []) {
      if (!e.startTime) continue;
      const start = Date.parse(e.startTime);
      const end = e.endTime ? Date.parse(e.endTime) : Date.now();
      ms += Math.max(0, end - start);
    }
    return ms;
  }, [batch.events]);

  const [elapsed, setElapsed] = useState(computeElapsed());
  useEffect(() => {
    setElapsed(computeElapsed());
    if (!hasOpenEvent) return;
    const id = setInterval(() => setElapsed(computeElapsed()), 1000);
    return () => clearInterval(id);
  }, [computeElapsed, hasOpenEvent]);

  const submitTimer = (intent: "start" | "stop") => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("type", eventType);
    timerFetcher.submit(fd, {
      method: "post",
      action: path.to.batch(batch.id as string)
    });
  };

  const initialValues = {
    batchId: batch.id as string,
    members: members.map((m) => ({
      jobOperationId: m.id,
      // Pre-fill with the operation quantity less any already completed (spec).
      quantity: Math.max(
        0,
        (m.operationQuantity ?? 0) - (m.quantityComplete ?? 0)
      ),
      scrapQuantity: 0
    }))
  } satisfies z.infer<typeof completeJobOperationBatchValidator>;

  // Controlled per-member quantities: react-aria NumberField does not pick up
  // RVF's nested-array defaults, so drive the values with local state instead.
  const [rows, setRows] = useState(
    initialValues.members.map((m) => ({
      quantity: m.quantity,
      scrapQuantity: m.scrapQuantity
    }))
  );
  const setRow = (i: number, key: "quantity" | "scrapQuantity", v: number) =>
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, [key]: v } : r))
    );

  const showControls = canRunTimer;

  return (
    <div
      className="w-full min-w-0 min-h-screen h-auto lg:h-screen bg-card relative"
      style={
        {
          "--controls-gutter": showControls ? "var(--controls-width)" : "0px"
        } as React.CSSProperties
      }
    >
      <header className="flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b px-2">
        <HStack className="w-full justify-between">
          <div className="flex items-center gap-0">
            <SidebarTrigger />
            <Button
              variant="ghost"
              leftIcon={<LuChevronLeft />}
              onClick={() => navigate(path.to.operations)}
              className="pl-2"
            >
              <Trans>Schedule</Trans>
            </Button>
          </div>
        </HStack>
      </header>

      <div className="flex flex-nowrap items-center justify-between px-4 lg:pl-6 py-2 min-h-[var(--header-height)] bg-background gap-2 md:gap-4 w-full min-w-0 overflow-hidden border-b">
        <HStack className="min-w-0 shrink-0 gap-2">
          <LuLayers className="text-muted-foreground shrink-0" />
          <Heading size="h4">
            {(batch as { readableId?: string }).readableId}
          </Heading>
          <Badge
            variant={
              isCompleted ? "green" : isCompleting ? "yellow" : "secondary"
            }
          >
            {status}
          </Badge>
        </HStack>
        <HStack className="hidden lg:flex min-w-0 flex-1 justify-end items-center gap-3 overflow-hidden">
          {(batch as { process?: { name: string | null } | null }).process
            ?.name && (
            <HStack className="min-w-0 justify-start space-x-2">
              <LuLayers className="text-muted-foreground shrink-0" />
              <span className="text-sm truncate">
                {
                  (batch as { process?: { name: string | null } | null })
                    .process?.name
                }
              </span>
            </HStack>
          )}
          {(batch as { workCenter?: { name: string | null } | null }).workCenter
            ?.name && (
            <HStack className="min-w-0 justify-start space-x-2">
              <LuFactory className="text-muted-foreground shrink-0" />
              <span className="text-sm truncate">
                {
                  (batch as { workCenter?: { name: string | null } | null })
                    .workCenter?.name
                }
              </span>
            </HStack>
          )}
          <HStack className="min-w-0 shrink-0 justify-start space-x-2">
            <LuTimer className="text-muted-foreground shrink-0" />
            <span className="text-sm tabular-nums">
              {formatDurationMilliseconds(elapsed)}
            </span>
          </HStack>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            <Trans>
              {members.length} jobs · {totalQuantity}
            </Trans>
          </span>
        </HStack>
      </div>

      <div className="flex flex-col gap-4 p-4 lg:pl-6 lg:pr-[calc(var(--controls-gutter)+1rem)] w-full">
        {isCompleting && (
          <Card>
            <CardContent className="py-4">
              <HStack className="justify-between">
                <span className="text-sm">
                  <Trans>
                    A previous completion did not finish. Retrying resumes the
                    remaining steps — quantities are not double-counted.
                  </Trans>
                </span>
                <Badge variant="yellow">
                  <Trans>Completing</Trans>
                </Badge>
              </HStack>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Complete Batch</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ValidatedForm
              method="post"
              action={path.to.batchComplete(batch.id as string)}
              validator={completeJobOperationBatchValidator}
              defaultValues={initialValues}
              className="flex flex-col gap-4"
            >
              <Hidden name="batchId" value={batch.id as string} />
              <Table>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Job</Trans>
                    </Th>
                    <Th>
                      <Trans>Operation</Trans>
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
                  {members.map((m, i) => (
                    <Tr key={m.id}>
                      <Td className="font-medium">
                        {(m.job as { jobId?: string | null } | null)?.jobId}
                      </Td>
                      <Td className="text-muted-foreground">{m.description}</Td>
                      <Td className="text-right">
                        <Hidden
                          name={`members[${i}].jobOperationId`}
                          value={m.id}
                        />
                        <NumberControlled
                          name={`members[${i}].quantity`}
                          label=""
                          value={rows[i]?.quantity ?? 0}
                          onChange={(v) => setRow(i, "quantity", v)}
                          minValue={0}
                          className="max-w-[120px] ml-auto"
                          isDisabled={completeDisabled}
                        />
                      </Td>
                      <Td className="text-right">
                        <NumberControlled
                          name={`members[${i}].scrapQuantity`}
                          label=""
                          value={rows[i]?.scrapQuantity ?? 0}
                          onChange={(v) => setRow(i, "scrapQuantity", v)}
                          minValue={0}
                          className="max-w-[120px] ml-auto"
                          isDisabled={completeDisabled}
                        />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              <HStack className="w-full justify-between">
                <span className="text-xs text-muted-foreground">
                  <Trans>
                    Time and cost split across jobs proportionally to quantity.
                  </Trans>
                </span>
                <Submit isDisabled={completeDisabled || hasOpenEvent}>
                  {isCompleting ? t`Retry Completion` : t`Complete Batch`}
                </Submit>
              </HStack>
              {hasOpenEvent && (
                <span className="text-xs text-muted-foreground">
                  <Trans>Stop the timer before completing the batch.</Trans>
                </span>
              )}
            </ValidatedForm>
          </CardContent>
        </Card>
      </div>

      {showControls && (
        <Controls>
          <WorkTypeToggle
            active={activeByType}
            operation={summedDurations as OperationWithDetails}
            value={eventType}
            onChange={(type) => {
              if (type) setEventType(type);
            }}
          />
          <div className="flex items-center justify-center py-4">
            {hasOpenEvent ? (
              <IconButtonWithTooltip
                icon={<LuCircleStop />}
                tooltip={t`Stop batch timer`}
                variant="destructive"
                disabled={timerFetcher.state !== "idle"}
                onClick={() => submitTimer("stop")}
              />
            ) : (
              <IconButtonWithTooltip
                icon={<LuPlay />}
                tooltip={t`Start batch timer`}
                variant="success"
                disabled={timerFetcher.state !== "idle"}
                onClick={() => submitTimer("start")}
              />
            )}
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              <Trans>Batch time</Trans>
            </span>
            <span className="text-sm font-mono tabular-nums whitespace-nowrap">
              {formatDurationMilliseconds(elapsed)}
            </span>
          </div>
        </Controls>
      )}
    </div>
  );
}
