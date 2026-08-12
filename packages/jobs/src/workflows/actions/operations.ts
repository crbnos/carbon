import { Constants, type Database } from "@carbon/database";
import {
  fromColumn,
  nullValue,
  type OperationDeclarationLike,
  type OperationOutcome,
  primitiveValue,
  type RuntimeValue,
  t,
  WORKFLOW_OPERATIONS
} from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<Database>;

/** One record in, one value out. `client` is the owner's, so RLS still applies. */
type Computation = (
  client: Client,
  companyId: string,
  recordId: string
) => Promise<OperationOutcome>;

const GONE = "This calculation is no longer available.";
const MISSING_RECORD = "This calculation needs a record to work from.";
const NOT_FOUND = "We could not find that record.";
const UNREADABLE = "We could not read the records this calculation needs.";

type JobOperationStatus = Database["public"]["Enums"]["jobOperationStatus"];
type TaskStatus = Database["public"]["Enums"]["nonConformanceTaskStatus"];

// Terminal per the generated enum; every other status counts as still open.
const CLOSED_OPERATION_STATUSES: JobOperationStatus[] = ["Canceled", "Done"];
const OPEN_OPERATION_STATUSES =
  Constants.public.Enums.jobOperationStatus.filter(
    (status) => !CLOSED_OPERATION_STATUSES.includes(status)
  );

const CLOSED_TASK_STATUSES: TaskStatus[] = ["Completed", "Skipped"];
const OPEN_TASK_STATUSES =
  Constants.public.Enums.nonConformanceTaskStatus.filter(
    (status) => !CLOSED_TASK_STATUSES.includes(status)
  );

function counted(result: {
  count: number | null;
  error: unknown;
}): OperationOutcome {
  if (result.error) return { ok: false, error: UNREADABLE };
  return { ok: true, value: primitiveValue("number", result.count ?? 0) };
}

function summed(values: (number | null)[]): OperationOutcome {
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return { ok: true, value: primitiveValue("number", total) };
}

/** Scrap across a job's operations, shared by the total and the percentage. */
async function jobScrapQuantity(
  client: Client,
  companyId: string,
  jobId: string
): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  const { data, error } = await client
    .from("jobOperation")
    .select("quantityScrapped")
    .eq("jobId", jobId)
    .eq("companyId", companyId);

  if (error || !data) return { ok: false, error: UNREADABLE };
  return {
    ok: true,
    total: data.reduce((sum, row) => sum + (row.quantityScrapped ?? 0), 0)
  };
}

const COMPUTATIONS: Record<string, Computation> = {
  // Stored totals live only on the view, which is why this is an operation.
  "purchaseOrder.total": async (client, companyId, id) => {
    const { data, error } = await client
      .from("purchaseOrders")
      .select("orderTotal")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();

    if (error) return { ok: false, error: UNREADABLE };
    if (!data) return { ok: false, error: NOT_FOUND };
    return { ok: true, value: primitiveValue("number", data.orderTotal ?? 0) };
  },

  "purchaseOrder.lineCount": async (client, companyId, id) =>
    counted(
      await client
        .from("purchaseOrderLine")
        .select("id", { count: "exact", head: true })
        .eq("purchaseOrderId", id)
        .eq("companyId", companyId)
    ),

  "salesOrder.total": async (client, companyId, id) => {
    const { data, error } = await client
      .from("salesOrders")
      .select("orderTotal")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();

    if (error) return { ok: false, error: UNREADABLE };
    if (!data) return { ok: false, error: NOT_FOUND };
    return { ok: true, value: primitiveValue("number", data.orderTotal ?? 0) };
  },

  "salesOrder.lineCount": async (client, companyId, id) =>
    counted(
      await client
        .from("salesOrderLine")
        .select("id", { count: "exact", head: true })
        .eq("salesOrderId", id)
        .eq("companyId", companyId)
    ),

  // Carbon stores no quote total: a quote line prices several quantity breaks
  // and the customer chooses one, so no single read can answer this.
  "quote.total": async () => ({
    ok: false,
    error:
      "A quote's total depends on which quantity the customer picks, so we cannot work it out."
  }),

  "receipt.lineCount": async (client, companyId, id) =>
    counted(
      await client
        .from("receiptLine")
        .select("id", { count: "exact", head: true })
        .eq("receiptId", id)
        .eq("companyId", companyId)
    ),

  "shipment.lineCount": async (client, companyId, id) =>
    counted(
      await client
        .from("shipmentLine")
        .select("id", { count: "exact", head: true })
        .eq("shipmentId", id)
        .eq("companyId", companyId)
    ),

  "job.totalScrapQuantity": async (client, companyId, id) => {
    const scrap = await jobScrapQuantity(client, companyId, id);
    if (!scrap.ok) return scrap;
    return { ok: true, value: primitiveValue("number", scrap.total) };
  },

  "job.scrapPercentage": async (client, companyId, id) => {
    const scrap = await jobScrapQuantity(client, companyId, id);
    if (!scrap.ok) return scrap;

    const { data, error } = await client
      .from("job")
      .select("quantity")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();

    if (error) return { ok: false, error: UNREADABLE };
    if (!data) return { ok: false, error: NOT_FOUND };

    // A job that makes nothing cannot have scrapped a proportion of it.
    const quantity = data.quantity ?? 0;
    if (quantity <= 0) return { ok: true, value: primitiveValue("number", 0) };

    return {
      ok: true,
      value: primitiveValue("number", (scrap.total / quantity) * 100)
    };
  },

  "job.operationCount": async (client, companyId, id) =>
    counted(
      await client
        .from("jobOperation")
        .select("id", { count: "exact", head: true })
        .eq("jobId", id)
        .eq("companyId", companyId)
    ),

  "job.openOperationCount": async (client, companyId, id) =>
    counted(
      await client
        .from("jobOperation")
        .select("id", { count: "exact", head: true })
        .eq("jobId", id)
        .eq("companyId", companyId)
        .in("status", OPEN_OPERATION_STATUSES)
    ),

  "job.earliestOperationStart": async (client, companyId, id) => {
    const { data, error } = await client
      .from("jobOperation")
      .select("startDate")
      .eq("jobId", id)
      .eq("companyId", companyId)
      .not("startDate", "is", null)
      .order("startDate", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) return { ok: false, error: UNREADABLE };
    // No scheduled operation is nothing, never an invented date.
    if (!data) return { ok: true, value: nullValue() };
    return { ok: true, value: fromColumn(t.date, data.startDate) };
  },

  "job.latestOperationEnd": async (client, companyId, id) => {
    const { data, error } = await client
      .from("jobOperation")
      .select("dueDate")
      .eq("jobId", id)
      .eq("companyId", companyId)
      .not("dueDate", "is", null)
      .order("dueDate", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return { ok: false, error: UNREADABLE };
    if (!data) return { ok: true, value: nullValue() };
    return { ok: true, value: fromColumn(t.date, data.dueDate) };
  },

  "nonConformance.openTaskCount": async (client, companyId, id) =>
    counted(
      await client
        .from("nonConformanceActionTask")
        .select("id", { count: "exact", head: true })
        .eq("nonConformanceId", id)
        .eq("companyId", companyId)
        .in("status", OPEN_TASK_STATUSES)
    ),

  "item.quantityOnHand": async (client, companyId, id) => {
    const { data, error } = await client
      .from("itemStockQuantities")
      .select("quantityOnHand")
      .eq("itemId", id)
      .eq("companyId", companyId);

    if (error || !data) return { ok: false, error: UNREADABLE };
    return summed(data.map((row) => row.quantityOnHand));
  }
};

/** The one entry point; an id with no implementation refuses rather than falls through. */
export async function runOperation(params: {
  client: Client;
  companyId: string;
  operationId: string;
  inputs: Record<string, RuntimeValue>;
}): Promise<OperationOutcome> {
  const { client, companyId, operationId, inputs } = params;

  const declarations: Record<string, OperationDeclarationLike> =
    WORKFLOW_OPERATIONS;
  const declaration = declarations[operationId];
  const computation = COMPUTATIONS[operationId];
  if (declaration === undefined || computation === undefined) {
    return { ok: false, error: GONE };
  }

  const input = inputs[declaration.entity];
  if (input === undefined || input.kind !== "entity") {
    return { ok: false, error: MISSING_RECORD };
  }

  try {
    return await computation(client, companyId, input.id);
  } catch {
    // An operation never throws into the walk; a broken read is a failed node.
    return { ok: false, error: UNREADABLE };
  }
}
