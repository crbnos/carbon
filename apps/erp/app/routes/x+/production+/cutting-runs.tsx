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
  getMaterialCharacteristics,
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

  // Attach material characteristics so the board can group by substance, shape,
  // grade or size — not only by the exact item. `material` is keyed by
  // item.readableId, so map through that.
  const readableIds = [
    ...new Set(
      (demand.data ?? [])
        .map((row) => (row.item as { readableId?: string } | null)?.readableId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const characteristics = await getMaterialCharacteristics(
    client,
    readableIds,
    companyId
  );
  const characteristicsByReadableId = new Map(
    (characteristics.data ?? []).map((row) => [row.id, row])
  );

  const enriched = (demand.data ?? []).map((row) => {
    const readableId = (row.item as { readableId?: string } | null)?.readableId;
    const material = readableId
      ? characteristicsByReadableId.get(readableId)
      : undefined;
    const name = (value: unknown) =>
      (value as { name?: string } | null)?.name ?? null;
    return {
      ...row,
      substance: name(material?.materialSubstance),
      shape: name(material?.materialForm),
      grade: name(material?.materialGrade),
      size: name(material?.materialDimension),
      finish: name(material?.materialFinish)
    };
  });

  return {
    demand: enriched,
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
      // The operation this demand feeds. Carrying it is what makes the run
      // stitch work orders: confirming the cut posts production against each
      // served operation instead of leaving every job's saw step at Todo.
      jobOperationId: row.jobOperationId ?? null,
      // Pieces of this material per finished part — 4 per part means 40 pieces
      // completes 10 parts, not 40.
      piecesPerParent: Number(row.quantity ?? 1) || 1,
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

/**
 * What a planner can pool demand by. Material is the common case but not the
 * only one — grouping by substance pools every 4130 regardless of diameter,
 * by shape pools all round tube, by size pools one wall thickness across grades.
 */
const GROUP_BY_OPTIONS = [
  { value: "itemId", label: "Material" },
  { value: "substance", label: "Substance" },
  { value: "shape", label: "Shape" },
  { value: "grade", label: "Grade" },
  { value: "size", label: "Size" },
  { value: "finish", label: "Finish" }
] as const;

type GroupByKey = (typeof GROUP_BY_OPTIONS)[number]["value"];

type DemandRow = {
  itemId: string;
  item?: { readableIdWithRevision?: string | null } | null;
  substance?: string | null;
  shape?: string | null;
  grade?: string | null;
  size?: string | null;
  finish?: string | null;
};

/**
 * Rows with no value for the chosen characteristic bucket under an explicit
 * "Unspecified" heading rather than vanishing — a planner needs to see that a
 * material has no grade recorded, not silently lose its demand.
 */
function groupKeyFor(
  row: DemandRow,
  groupBy: GroupByKey
): { key: string; label: string } {
  if (groupBy === "itemId") {
    return {
      key: row.itemId,
      label: row.item?.readableIdWithRevision ?? row.itemId
    };
  }
  const value = row[groupBy];
  return value
    ? { key: `${groupBy}:${value}`, label: value }
    : { key: `${groupBy}:__none__`, label: "Unspecified" };
}

export default function PlanCuttingRunRoute() {
  const { demand, processes } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const fetcher = useFetcher();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processId, setProcessId] = useState<string>("");

  // Group by a chosen characteristic, not always the exact item. A planner
  // wants "everything on the saw in 1/2-inch 4140" some days and "everything in
  // 4130, whatever the diameter" on others — the material itself is only one
  // characteristic among several.
  const [groupBy, setGroupBy] = useState<GroupByKey>("itemId");

  const groups = useMemo(() => {
    const buckets = new Map<string, { label: string; rows: typeof demand }>();
    for (const row of demand) {
      const { key, label } = groupKeyFor(row, groupBy);
      const bucket = buckets.get(key) ?? { label, rows: [] };
      bucket.rows.push(row);
      buckets.set(key, bucket);
    }
    // Biggest blocks first — the runs most worth batching.
    return [...buckets.entries()].sort(
      (a, b) => b[1].rows.length - a[1].rows.length
    );
  }, [demand, groupBy]);

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
            aria-label={t`Group by`}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={groupBy}
            onChange={(event) => {
              setGroupBy(event.target.value as GroupByKey);
              // Selection is keyed by demand row, not by bucket, so it stays
              // valid across a regroup — but clearing avoids a half-selected
              // group reading as a whole one.
              setSelected(new Set());
            }}
          >
            {GROUP_BY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t`Group by`}: {option.label}
              </option>
            ))}
          </select>
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
        groups.map(([groupKey, group]) => {
          const rows = group.rows;
          const item = rows[0].item as {
            readableIdWithRevision?: string | null;
            name?: string | null;
          } | null;
          const allSelected = rows.every((row) => selected.has(row.id));
          return (
            <Card key={groupKey} className="w-full">
              <CardHeader>
                <CardTitle>
                  <HStack>
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={() => toggleGroup(rows)}
                    />
                    <span>{group.label}</span>
                    <Badge variant="secondary">
                      {rows.length} {t`line(s)`}
                    </Badge>
                  </HStack>
                </CardTitle>
                <CardDescription>
                  {groupBy === "itemId"
                    ? (item?.name ?? "")
                    : t`${new Set(rows.map((row) => row.itemId)).size} material(s) in this group`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <Thead>
                    <Tr>
                      <Th className="w-10" />
                      <Th>{t`Job`}</Th>
                      {groupBy !== "itemId" && <Th>{t`Material`}</Th>}
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
                          {groupBy !== "itemId" && (
                            <Td className="text-muted-foreground">
                              {(
                                row.item as {
                                  readableIdWithRevision?: string | null;
                                } | null
                              )?.readableIdWithRevision ?? "—"}
                            </Td>
                          )}
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
