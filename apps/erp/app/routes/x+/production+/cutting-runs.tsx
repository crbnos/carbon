import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
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
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuScissors } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useFetcher, useLoaderData } from "react-router";
import {
  getCuttingProcessesList,
  getOpenCutDemand,
  runCutOptimization,
  upsertCutList,
  upsertCutListLine
} from "~/modules/production";
import { getNextSequence } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Cutting Runs`,
  to: path.to.cuttingRuns
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const [demand, processes] = await Promise.all([
    getOpenCutDemand(client, companyId),
    getCuttingProcessesList(client, companyId)
  ]);

  return {
    demand: demand.data ?? [],
    processes: processes.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const formData = await request.formData();
  const processId = formData.get("processId");
  const selected = formData.getAll("jobMaterialId").map(String);

  if (selected.length === 0) {
    return data(
      {},
      await flash(request, error(null, "Select at least one piece to cut"))
    );
  }

  const demand = await getOpenCutDemand(client, companyId);
  if (demand.error) {
    return data(
      {},
      await flash(request, error(demand.error, "Failed to load cut demand"))
    );
  }

  const rows = (demand.data ?? []).filter((row) => selected.includes(row.id));
  if (rows.length === 0) {
    return data(
      {},
      await flash(request, error(null, "The selected demand is no longer open"))
    );
  }

  const sequence = await getNextSequence(client, "cutList", companyId);
  if (sequence.error || !sequence.data) {
    return data(
      {},
      await flash(
        request,
        error(sequence.error, "Failed to generate cut list id")
      )
    );
  }

  // Seed the saw parameters from the chosen machine — the planner shouldn't
  // have to remember this shop's blade width.
  let params = { kerf: 0, endTrim: 0, gripMargin: 0, minRemnantLength: 0 };
  if (typeof processId === "string" && processId) {
    const processes = await getCuttingProcessesList(client, companyId);
    const process = (processes.data ?? []).find((p) => p.id === processId);
    if (process) {
      params = {
        kerf: Number(process.defaultKerf ?? 0),
        endTrim: Number(process.defaultEndTrim ?? 0),
        gripMargin: Number(process.defaultGripMargin ?? 0),
        minRemnantLength: Number(process.defaultMinRemnantLength ?? 0)
      };
    }
  }

  const firstJob = rows[0].job as { locationId?: string | null } | null;

  const created = await upsertCutList(client, {
    cutListId: sequence.data as string,
    processId:
      typeof processId === "string" && processId ? processId : undefined,
    locationId: firstJob?.locationId ?? undefined,
    workCenterId: undefined,
    unitOfDimension: "in",
    assignee: undefined,
    ...params,
    companyId,
    createdBy: userId
  });

  if (created.error || !created.data?.id) {
    return data(
      {},
      await flash(request, error(created.error, "Failed to create cut list"))
    );
  }

  const cutListId = created.data.id;

  for (const row of rows) {
    // Each job material becomes one demand line. quantityToIssue is what the
    // job still owes; cutLength is how long each piece has to be.
    const line = await upsertCutListLine(client, {
      cutListId,
      jobId: row.jobId ?? undefined,
      jobMaterialId: row.id,
      itemId: row.itemId,
      pieceLength: Number(row.cutLength),
      pieceWidth: row.cutWidth === null ? undefined : Number(row.cutWidth),
      quantity: Math.ceil(Number(row.quantityToIssue ?? 0)),
      companyId,
      createdBy: userId
    });

    if (line.error) {
      return data(
        {},
        await flash(request, error(line.error, "Failed to add a piece"))
      );
    }
  }

  // Plan it straight away — a run builder that hands back an unplanned list
  // makes the planner do the same click twice.
  await runCutOptimization(client, { cutListId, companyId, userId });

  throw redirect(
    path.to.cutList(cutListId),
    await flash(
      request,
      success(`Cut list created from ${rows.length} job line(s)`)
    )
  );
}

export default function PlanCuttingRunRoute() {
  const { demand, processes } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const fetcher = useFetcher();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processId, setProcessId] = useState<string>("");

  // Group demand the way every system in the industry does: by material, so a
  // planner sees "everything on the saw in 1/2-inch 4140" in one block.
  const groups = useMemo(() => {
    const byItem = new Map<string, typeof demand>();
    for (const row of demand) {
      const list = byItem.get(row.itemId) ?? [];
      list.push(row);
      byItem.set(row.itemId, list);
    }
    return [...byItem.entries()];
  }, [demand]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (rows: typeof demand) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = rows.every((row) => next.has(row.id));
      for (const row of rows) {
        if (allSelected) next.delete(row.id);
        else next.add(row.id);
      }
      return next;
    });
  };

  const onCreate = () => {
    const formData = new FormData();
    if (processId) formData.set("processId", processId);
    for (const id of selected) formData.append("jobMaterialId", id);
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <VStack spacing={4} className="p-4 h-full overflow-y-auto">
      <HStack className="w-full justify-between items-start">
        <VStack spacing={1}>
          <Heading size="h3">{t`Plan a cutting run`}</Heading>
          <p className="text-sm text-muted-foreground">
            {t`Open cut demand across released jobs. Pick what runs together on one machine.`}
          </p>
        </VStack>
        <HStack>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={processId}
            onChange={(event) => setProcessId(event.target.value)}
          >
            <option value="">{t`No process`}</option>
            {processes.map((process) => (
              <option key={process.id} value={process.id}>
                {process.name}
              </option>
            ))}
          </select>
          <Button
            leftIcon={<LuScissors />}
            variant="primary"
            isDisabled={selected.size === 0 || fetcher.state !== "idle"}
            isLoading={fetcher.state !== "idle"}
            onClick={onCreate}
          >
            {t`Create cut list`} {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </HStack>
      </HStack>

      {groups.length === 0 ? (
        <Card className="w-full">
          <CardContent className="py-12">
            <p className="text-center text-muted-foreground">
              {t`No open cut demand. A job material needs a cut length before it shows up here.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        groups.map(([itemId, rows]) => {
          const item = rows[0].item as {
            readableIdWithRevision?: string | null;
            name?: string | null;
          } | null;
          const allSelected = rows.every((row) => selected.has(row.id));
          return (
            <Card key={itemId} className="w-full">
              <CardHeader>
                <CardTitle>
                  <HStack>
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={() => toggleGroup(rows)}
                    />
                    <span>{item?.readableIdWithRevision ?? itemId}</span>
                    <Badge variant="secondary">
                      {rows.length} {t`line(s)`}
                    </Badge>
                  </HStack>
                </CardTitle>
                <CardDescription>{item?.name ?? ""}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <Thead>
                    <Tr>
                      <Th className="w-10" />
                      <Th>{t`Job`}</Th>
                      <Th>{t`Due`}</Th>
                      <Th className="text-right">{t`Cut length`}</Th>
                      <Th className="text-right">{t`Pieces owed`}</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {rows.map((row) => {
                      const job = row.job as {
                        jobId?: string | null;
                        dueDate?: string | null;
                      } | null;
                      return (
                        <Tr key={row.id}>
                          <Td>
                            <Checkbox
                              checked={selected.has(row.id)}
                              onCheckedChange={() => toggle(row.id)}
                            />
                          </Td>
                          <Td>{job?.jobId ?? "—"}</Td>
                          <Td className="text-muted-foreground">
                            {job?.dueDate ?? "—"}
                          </Td>
                          <Td className="text-right tabular-nums">
                            {row.cutLength}
                          </Td>
                          <Td className="text-right tabular-nums">
                            {Math.ceil(Number(row.quantityToIssue ?? 0))}
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              </CardContent>
            </Card>
          );
        })
      )}
    </VStack>
  );
}
