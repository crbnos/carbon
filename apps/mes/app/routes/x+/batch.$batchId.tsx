import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { Hidden, NumberControlled, Submit, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { formatDurationMilliseconds } from "@carbon/utils";
import { getLocalTimeZone, now } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { z } from "zod";
import { completeJobOperationBatchValidator } from "~/services/models";
import {
  getJobOperationBatch,
  startProductionEvent
} from "~/services/operations.service";
import { path } from "~/utils/path";

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
    const startEvent = await startProductionEvent(
      serviceRole,
      {
        type: "Machine",
        jobOperationId: firstMember.id,
        workCenterId: (batch.data.workCenterId ??
          firstMember.workCenterId) as string,
        startTime: now(getLocalTimeZone()).toAbsoluteString(),
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
        endTime: now(getLocalTimeZone()).toAbsoluteString(),
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

  return (
    <div className="mx-auto w-full max-w-3xl p-4">
      <VStack spacing={4}>
        <Card>
          <CardHeader>
            <HStack className="w-full justify-between">
              <HStack spacing={2}>
                <CardTitle>
                  {(batch as { readableId?: string }).readableId}
                </CardTitle>
                <Badge
                  variant={
                    isCompleted
                      ? "green"
                      : isCompleting
                        ? "yellow"
                        : "secondary"
                  }
                >
                  {status}
                </Badge>
              </HStack>
              <Heading size="h4">
                <Trans>
                  {members.length} jobs · {totalQuantity}
                </Trans>
              </Heading>
            </HStack>
          </CardHeader>
          {canRunTimer && (
            <CardContent>
              <HStack className="w-full justify-between" spacing={2}>
                <span className="font-mono text-lg">
                  {formatDurationMilliseconds(elapsed)}
                </span>
                <ValidatedForm
                  method="post"
                  validator={z.object({ intent: z.string() })}
                  defaultValues={{ intent: hasOpenEvent ? "stop" : "start" }}
                  action={path.to.batch(batch.id as string)}
                >
                  <Hidden
                    name="intent"
                    value={hasOpenEvent ? "stop" : "start"}
                  />
                  <Submit variant={hasOpenEvent ? "destructive" : "primary"}>
                    {hasOpenEvent ? t`End Batch` : t`Start Batch`}
                  </Submit>
                </ValidatedForm>
              </HStack>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Complete Batch</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isCompleting && (
              <p className="pb-2 text-xs text-yellow-600 dark:text-yellow-500">
                <Trans>
                  A previous completion did not finish. Retrying resumes the
                  remaining steps — quantities are not double-counted.
                </Trans>
              </p>
            )}
            <ValidatedForm
              method="post"
              validator={completeJobOperationBatchValidator}
              defaultValues={initialValues}
              action={path.to.batchComplete(batch.id as string)}
            >
              <Hidden name="batchId" />
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
                      <Td>{(m.job as { jobId?: string } | null)?.jobId}</Td>
                      <Td className="text-muted-foreground">{m.description}</Td>
                      <Td>
                        <Hidden
                          name={`members[${i}].jobOperationId`}
                          value={m.id}
                        />
                        <NumberControlled
                          name={`members[${i}].quantity`}
                          label=""
                          minValue={0}
                          isDisabled={completeDisabled}
                          value={rows[i]?.quantity ?? 0}
                          onChange={(v) => setRow(i, "quantity", v)}
                        />
                      </Td>
                      <Td>
                        <NumberControlled
                          name={`members[${i}].scrapQuantity`}
                          label=""
                          minValue={0}
                          isDisabled={completeDisabled}
                          value={rows[i]?.scrapQuantity ?? 0}
                          onChange={(v) => setRow(i, "scrapQuantity", v)}
                        />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              <p className="py-2 text-xs text-muted-foreground">
                <Trans>
                  Time and cost split across jobs proportionally to quantity.
                </Trans>
              </p>
              <Submit isDisabled={completeDisabled}>
                {isCompleting ? t`Retry Completion` : t`Complete Batch`}
              </Submit>
            </ValidatedForm>
          </CardContent>
        </Card>
      </VStack>
    </div>
  );
}
