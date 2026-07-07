import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { Hidden, NumberControlled, Submit, ValidatedForm } from "@carbon/form";
import {
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
import { getLocalTimeZone, now } from "@internationalized/date";
import { useState } from "react";
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
  const { batch, hasOpenEvent } = useLoaderData<typeof loader>();
  const members = batch.operations ?? [];
  const totalQuantity = members.reduce(
    (sum, m) => sum + (m.operationQuantity ?? 0),
    0
  );

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
              <CardTitle>
                {(batch as { readableId?: string }).readableId}
              </CardTitle>
              <Heading size="h4">
                {members.length} jobs · {totalQuantity}
              </Heading>
            </HStack>
          </CardHeader>
          <CardContent>
            <HStack spacing={2}>
              <ValidatedForm
                method="post"
                validator={z.object({ intent: z.string() })}
                defaultValues={{ intent: hasOpenEvent ? "stop" : "start" }}
                action={path.to.batch(batch.id as string)}
              >
                <Hidden name="intent" value={hasOpenEvent ? "stop" : "start"} />
                <Submit variant={hasOpenEvent ? "destructive" : "primary"}>
                  {hasOpenEvent ? "Stop" : "Start"}
                </Submit>
              </ValidatedForm>
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Complete Batch</CardTitle>
          </CardHeader>
          <CardContent>
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
                    <Th>Job</Th>
                    <Th>Item</Th>
                    <Th className="text-right">Quantity</Th>
                    <Th className="text-right">Scrap</Th>
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
                          value={rows[i]?.quantity ?? 0}
                          onChange={(v) => setRow(i, "quantity", v)}
                        />
                      </Td>
                      <Td>
                        <NumberControlled
                          name={`members[${i}].scrapQuantity`}
                          label=""
                          minValue={0}
                          value={rows[i]?.scrapQuantity ?? 0}
                          onChange={(v) => setRow(i, "scrapQuantity", v)}
                        />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              <p className="py-2 text-xs text-muted-foreground">
                Time and cost split across jobs proportionally to quantity.
              </p>
              <Submit>Complete Batch</Submit>
            </ValidatedForm>
          </CardContent>
        </Card>
      </VStack>
    </div>
  );
}
