import type { Database } from "@carbon/database";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCompanyTimeZone,
  getLocationTimeZone
} from "~/modules/shared/timezone.server";
import { path } from "~/utils/path";
import {
  analyzeDelay,
  calendarDays,
  type DelayLink,
  type DelayNode,
  type DelayReport,
  type DelayResult,
  redactDelay
} from "./delay";

type Client = SupabaseClient<Database>;

const PAGE = 1000;
const JOB_DONE = new Set(["Completed", "Closed", "Cancelled"]);
const OP_DONE = new Set(["Done", "Canceled"]);

async function allRows<T>(
  run: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    const batch = data ?? [];
    if (error) throw new Error(error.message);
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function day(value: string | null | undefined, tz: string): string | null {
  if (!value) return null;
  if (value.length === 10) return value;
  return datetime.businessDay(value, tz).toString();
}

function finish(args: {
  planned: string | null;
  actual: string | null;
  projected: string | null;
  done: boolean;
  today: string;
}): string | null {
  if (args.done) return args.actual ?? args.projected ?? args.planned;
  if (args.projected) return args.projected;
  if (args.planned && args.planned < args.today) return args.today;
  return null;
}

async function timeZone(
  client: Client,
  companyId: string,
  locationId: string | null
): Promise<{ tz: string; today: string }> {
  const tz = locationId
    ? await getLocationTimeZone(client, locationId, companyId)
    : await getCompanyTimeZone(client, companyId);
  return { tz, today: datetime.today(tz).toString() };
}

type Graph = { nodes: DelayNode[]; links: DelayLink[] };

async function graphForJobs(
  client: Client,
  companyId: string,
  jobIds: string[],
  lineIds: string[],
  today: string,
  tz: string
): Promise<Graph> {
  const nodes: DelayNode[] = [];
  const links: DelayLink[] = [];
  if (jobIds.length === 0 && lineIds.length === 0) return { nodes, links };

  const jobs = jobIds.length
    ? await allRows((from, to) =>
        client
          .from("job")
          .select(
            "id, jobId, status, dueDate, completedDate, projectedCompletionAt, salesOrderLineId"
          )
          .eq("companyId", companyId)
          .in("id", jobIds)
          .order("id")
          .range(from, to)
      )
    : [];

  const operations = jobIds.length
    ? await allRows((from, to) =>
        client
          .from("jobOperation")
          .select(
            "id, jobId, status, dueDate, startDate, projectedCompletionAt, order, process(name)"
          )
          .eq("companyId", companyId)
          .in("jobId", jobIds)
          .order("id")
          .range(from, to)
      )
    : [];

  const liveOps = operations.filter((op) => op.status !== "Canceled");
  const opIds = liveOps.map((op) => op.id);

  const [dependencies, materials, events, holds, linesByJob, linesByOp] =
    await Promise.all([
      jobIds.length
        ? allRows((from, to) =>
            client
              .from("jobOperationDependency")
              .select("operationId, dependsOnId")
              .eq("companyId", companyId)
              .in("jobId", jobIds)
              .order("operationId")
              .order("dependsOnId")
              .range(from, to)
          )
        : [],
      jobIds.length
        ? allRows((from, to) =>
            client
              .from("jobMaterial")
              .select("jobId, itemId, jobOperationId")
              .eq("companyId", companyId)
              .in("jobId", jobIds)
              .order("id")
              .range(from, to)
          )
        : [],
      opIds.length
        ? allRows((from, to) =>
            client
              .from("productionEvent")
              .select("jobOperationId, startTime, endTime")
              .eq("companyId", companyId)
              .in("jobOperationId", opIds)
              .order("id")
              .range(from, to)
          )
        : [],
      jobIds.length
        ? allRows((from, to) =>
            client
              .from("nonConformanceJobOperation")
              .select(
                "id, jobOperationId, nonConformanceId, nonConformance(nonConformanceId, openDate, closeDate, dueDate, status)"
              )
              .eq("companyId", companyId)
              .in("jobId", jobIds)
              .order("id")
              .range(from, to)
          )
        : [],
      jobIds.length
        ? allRows((from, to) =>
            client
              .from("purchaseOrderLine")
              .select(
                "id, jobId, jobOperationId, itemId, promisedDate, requiredDate, receivedDate, receivedComplete, purchaseOrderId, purchaseOrder(purchaseOrderId, supplier(name)), item(readableId)"
              )
              .eq("companyId", companyId)
              .in("jobId", jobIds)
              .order("id")
              .range(from, to)
          )
        : [],
      opIds.length
        ? allRows((from, to) =>
            client
              .from("purchaseOrderLine")
              .select(
                "id, jobId, jobOperationId, itemId, promisedDate, requiredDate, receivedDate, receivedComplete, purchaseOrderId, purchaseOrder(purchaseOrderId, supplier(name)), item(readableId)"
              )
              .eq("companyId", companyId)
              .in("jobOperationId", opIds)
              .order("id")
              .range(from, to)
          )
        : []
    ]);

  const salesLineIds = [
    ...new Set([
      ...lineIds,
      ...jobs.flatMap((job) =>
        job.salesOrderLineId ? [job.salesOrderLineId] : []
      )
    ])
  ];
  const salesLines = salesLineIds.length
    ? await allRows((from, to) =>
        client
          .from("salesOrderLine")
          .select(
            "id, salesOrderId, promisedDate, sentDate, sentComplete, item(readableId), salesOrder(salesOrderId)"
          )
          .eq("companyId", companyId)
          .in("id", salesLineIds)
          .order("id")
          .range(from, to)
      )
    : [];

  const eventSpan = new Map<string, { start: string; end: string }>();
  for (const event of events) {
    const start = day(event.startTime, tz);
    const end = day(event.endTime, tz) ?? start;
    if (!start || !end) continue;
    const current = eventSpan.get(event.jobOperationId);
    if (!current) {
      eventSpan.set(event.jobOperationId, { start, end });
      continue;
    }
    if (start < current.start) current.start = start;
    if (end > current.end) current.end = end;
  }

  const opNode = new Set(opIds.map((id) => `op:${id}`));
  const jobNode = new Set(jobs.map((job) => `job:${job.id}`));

  for (const job of jobs) {
    const planned = day(job.dueDate, tz);
    const done = JOB_DONE.has(job.status);
    nodes.push({
      id: `job:${job.id}`,
      kind: "job",
      label: job.jobId,
      href: path.to.job(job.id),
      planned,
      actual: finish({
        planned,
        actual: day(job.completedDate, tz),
        projected: day(job.projectedCompletionAt, tz),
        done,
        today
      }),
      open: !done
    });
  }

  for (const op of liveOps) {
    const planned = day(op.dueDate, tz);
    const plannedStart = day(op.startDate, tz);
    const done = OP_DONE.has(op.status);
    const span = eventSpan.get(op.id);
    const projected = day(op.projectedCompletionAt, tz);
    const actual = finish({
      planned,
      actual: done ? (span?.end ?? null) : null,
      projected,
      done,
      today
    });
    let ranLongDays: number | undefined;
    if (plannedStart && planned && span) {
      const over =
        calendarDays(span.end, span.start) -
        Math.max(0, calendarDays(planned, plannedStart));
      if (over > 0) ranLongDays = over;
    }
    const processName = one(op.process)?.name;
    nodes.push({
      id: `op:${op.id}`,
      kind: "operation",
      label: processName
        ? op.order == null
          ? processName
          : `${processName} ${op.order}`
        : undefined,
      href: path.to.job(op.jobId),
      planned,
      plannedStart: plannedStart ?? planned,
      actual,
      ranLongDays,
      open: !done
    });
    if (jobNode.has(`job:${op.jobId}`)) {
      links.push({
        from: `op:${op.id}`,
        to: `job:${op.jobId}`,
        recorded: true
      });
    }
  }

  for (const dep of dependencies) {
    if (
      !opNode.has(`op:${dep.dependsOnId}`) ||
      !opNode.has(`op:${dep.operationId}`)
    ) {
      continue;
    }
    links.push({
      from: `op:${dep.dependsOnId}`,
      to: `op:${dep.operationId}`,
      recorded: true
    });
  }

  for (const line of salesLines) {
    const planned = day(line.promisedDate, tz);
    const order = one(line.salesOrder);
    const item = one(line.item);
    const label = [order?.salesOrderId, item?.readableId]
      .filter(Boolean)
      .join(" · ");
    nodes.push({
      id: `line:${line.id}`,
      kind: "salesLine",
      label: label || undefined,
      href: path.to.salesOrder(line.salesOrderId),
      planned,
      actual: line.sentComplete
        ? (day(line.sentDate, tz) ?? planned)
        : planned && planned < today
          ? today
          : null,
      open: !line.sentComplete
    });
  }

  const lineNode = new Set(salesLines.map((line) => `line:${line.id}`));
  for (const job of jobs) {
    if (
      !job.salesOrderLineId ||
      !lineNode.has(`line:${job.salesOrderLineId}`)
    ) {
      continue;
    }
    links.push({
      from: `job:${job.id}`,
      to: `line:${job.salesOrderLineId}`,
      recorded: true
    });
  }

  const materialOps = new Map<string, string[]>();
  for (const material of materials) {
    if (
      !material.jobOperationId ||
      !opNode.has(`op:${material.jobOperationId}`)
    ) {
      continue;
    }
    const key = `${material.jobId}:${material.itemId}`;
    const list = materialOps.get(key) ?? [];
    list.push(material.jobOperationId);
    materialOps.set(key, list);
  }

  const purchaseLines = new Map<string, (typeof linesByJob)[number]>();
  for (const line of [...linesByJob, ...linesByOp])
    purchaseLines.set(line.id, line);

  for (const line of purchaseLines.values()) {
    const planned = day(line.promisedDate, tz) ?? day(line.requiredDate, tz);
    if (!planned) continue;
    const header = one(line.purchaseOrder);
    const supplier = one(header?.supplier);
    const item = one(line.item);
    const received = day(line.receivedDate, tz);
    nodes.push({
      id: `po:${line.id}`,
      kind: line.jobOperationId ? "outside" : "supply",
      label: [header?.purchaseOrderId, supplier?.name, item?.readableId]
        .filter(Boolean)
        .join(" · "),
      href: path.to.purchaseOrder(line.purchaseOrderId),
      planned,
      actual: line.receivedComplete
        ? (received ?? planned)
        : planned < today
          ? today
          : null,
      open: !line.receivedComplete
    });

    if (line.jobOperationId && opNode.has(`op:${line.jobOperationId}`)) {
      links.push({
        from: `po:${line.id}`,
        to: `op:${line.jobOperationId}`,
        recorded: true
      });
      continue;
    }

    const matched = line.jobId
      ? (materialOps.get(`${line.jobId}:${line.itemId}`) ?? [])
      : [];
    if (matched.length > 0) {
      for (const opId of matched) {
        links.push({
          from: `po:${line.id}`,
          to: `op:${opId}`,
          recorded: false
        });
      }
      continue;
    }

    if (line.jobId && jobNode.has(`job:${line.jobId}`)) {
      links.push({
        from: `po:${line.id}`,
        to: `job:${line.jobId}`,
        recorded: true
      });
    }
  }

  for (const hold of holds) {
    const issue = one(hold.nonConformance);
    if (!issue || !opNode.has(`op:${hold.jobOperationId}`)) continue;
    const planned = day(issue.dueDate, tz) ?? day(issue.openDate, tz);
    if (!planned) continue;
    const closed = issue.status === "Closed";
    nodes.push({
      id: `ncr:${hold.id}`,
      kind: "quality",
      label: issue.nonConformanceId,
      href: path.to.issue(hold.nonConformanceId),
      planned,
      actual: closed
        ? (day(issue.closeDate, tz) ?? day(issue.openDate, tz))
        : planned < today
          ? today
          : null
    });
    links.push({
      from: `ncr:${hold.id}`,
      to: `op:${hold.jobOperationId}`,
      recorded: true
    });
  }

  return { nodes, links };
}

function worthShowing(report: DelayReport): boolean {
  return (
    report.lateDays > 0 ||
    report.causes.length > 0 ||
    report.impacts.length > 0 ||
    report.absorbed.length > 0 ||
    report.gaps.length > 0
  );
}

export async function getDelayAnalysis(
  client: Client,
  companyId: string,
  kind: "job" | "sales-order" | "purchase-order",
  id: string,
  canView: (module: string) => boolean
): Promise<DelayResult | null> {
  if (kind === "job") {
    const job = await client
      .from("job")
      .select("id, locationId")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();
    if (job.error) throw new Error(job.error.message);
    if (!job.data) return null;
    const { tz, today } = await timeZone(
      client,
      companyId,
      job.data.locationId
    );
    const graph = await graphForJobs(client, companyId, [id], [], today, tz);
    return redactDelay(
      analyzeDelay({ ...graph, mode: "why", targetId: `job:${id}` }),
      canView
    );
  }

  if (kind === "sales-order") {
    const order = await client
      .from("salesOrder")
      .select("id, locationId")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();
    if (order.error) throw new Error(order.error.message);
    if (!order.data) return null;

    const lines = await client
      .from("salesOrderLine")
      .select("id")
      .eq("salesOrderId", id)
      .eq("companyId", companyId);
    if (lines.error) throw new Error(lines.error.message);
    const lineIds = (lines.data ?? []).map((line) => line.id);

    const [byOrder, byLine] = await Promise.all([
      client
        .from("job")
        .select("id")
        .eq("companyId", companyId)
        .eq("salesOrderId", id),
      lineIds.length
        ? client
            .from("job")
            .select("id")
            .eq("companyId", companyId)
            .in("salesOrderLineId", lineIds)
        : Promise.resolve({ data: [], error: null })
    ]);
    if (byOrder.error) throw new Error(byOrder.error.message);
    if (byLine.error) throw new Error(byLine.error.message);
    const jobIds = [
      ...new Set([
        ...(byOrder.data ?? []).map((job) => job.id),
        ...(byLine.data ?? []).map((job) => job.id)
      ])
    ];

    const { tz, today } = await timeZone(
      client,
      companyId,
      order.data.locationId
    );
    const graph = await graphForJobs(
      client,
      companyId,
      jobIds,
      lineIds,
      today,
      tz
    );
    const reports: DelayReport[] = [];
    for (const lineId of lineIds) {
      const result = analyzeDelay({
        ...graph,
        mode: "why",
        targetId: `line:${lineId}`
      });
      if ("cycle" in result) return redactDelay(result, canView);
      const report = result.reports[0];
      if (report && worthShowing(report)) reports.push(report);
    }
    reports.sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
    return redactDelay(
      {
        reports:
          reports.length > 0
            ? reports
            : [{ lateDays: 0, causes: [], impacts: [], absorbed: [], gaps: [] }]
      },
      canView
    );
  }

  const order = await client
    .from("purchaseOrder")
    .select("id")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (order.error) throw new Error(order.error.message);
  if (!order.data) return null;

  const lines = await client
    .from("purchaseOrderLine")
    .select("id, jobId, jobOperationId, locationId")
    .eq("purchaseOrderId", id)
    .eq("companyId", companyId);
  if (lines.error) throw new Error(lines.error.message);

  const jobIds = new Set(
    (lines.data ?? []).flatMap((line) => (line.jobId ? [line.jobId] : []))
  );
  const orphanOps = (lines.data ?? []).flatMap((line) =>
    line.jobOperationId && !line.jobId ? [line.jobOperationId] : []
  );
  if (orphanOps.length > 0) {
    const ops = await client
      .from("jobOperation")
      .select("jobId")
      .eq("companyId", companyId)
      .in("id", orphanOps);
    if (ops.error) throw new Error(ops.error.message);
    for (const op of ops.data ?? []) jobIds.add(op.jobId);
  }

  const locationId =
    (lines.data ?? []).find((line) => line.locationId)?.locationId ?? null;
  const { tz, today } = await timeZone(client, companyId, locationId);
  const graph = await graphForJobs(
    client,
    companyId,
    [...jobIds],
    [],
    today,
    tz
  );
  const reports: DelayReport[] = [];
  for (const line of lines.data ?? []) {
    if (!graph.nodes.some((node) => node.id === `po:${line.id}`)) continue;
    const result = analyzeDelay({
      ...graph,
      mode: "affects",
      sourceId: `po:${line.id}`
    });
    if ("cycle" in result) return redactDelay(result, canView);
    const report = result.reports[0];
    if (report && worthShowing(report)) reports.push(report);
  }
  reports.sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
  return redactDelay(
    {
      reports:
        reports.length > 0
          ? reports
          : [{ lateDays: 0, causes: [], impacts: [], absorbed: [], gaps: [] }]
    },
    canView
  );
}
