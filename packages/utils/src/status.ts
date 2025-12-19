import type { Database } from "@carbon/database";

type SalesOrderLine = Pick<
  Database["public"]["Tables"]["salesOrderLine"]["Row"],
  | "salesOrderLineType"
  | "invoicedComplete"
  | "sentComplete"
  | "id"
  | "methodType"
  | "saleQuantity"
  | "quantitySent"
>;

type SalesOrderJob = Pick<
  Database["public"]["Tables"]["job"]["Row"],
  | "salesOrderLineId"
  | "productionQuantity"
  | "quantityComplete"
  | "status"
  | "id"
  | "jobId"
  | "dueDate"
>;

export const getSalesOrderStatus = (
  lines: Array<{
    salesOrderLineType: SalesOrderLine["salesOrderLineType"] | null;
    invoicedComplete: SalesOrderLine["invoicedComplete"] | null;
    sentComplete: SalesOrderLine["sentComplete"] | null;
  }>
) => {
  const allInvoiced = lines.every(
    (line) => line.salesOrderLineType === "Comment" || line.invoicedComplete
  );

  const allShipped = lines.every(
    (line) => line.salesOrderLineType === "Comment" || line.sentComplete
  );

  let status: Database["public"]["Tables"]["salesOrder"]["Row"]["status"] =
    "To Ship and Invoice";

  if (allInvoiced && allShipped) {
    status = "Completed";
  } else if (allShipped) {
    status = "To Invoice";
  } else if (allInvoiced) {
    status = "To Ship";
  }

  return { status, allInvoiced, allShipped };
};

type PurchaseOrderLine = Pick<
  Database["public"]["Tables"]["purchaseOrderLine"]["Row"],
  "purchaseOrderLineType" | "receivedComplete" | "invoicedComplete"
>;

export const getPurchaseOrderStatus = (
  lines: Array<{
    purchaseOrderLineType: PurchaseOrderLine["purchaseOrderLineType"] | null;
    invoicedComplete: PurchaseOrderLine["invoicedComplete"] | null;
    receivedComplete: PurchaseOrderLine["receivedComplete"] | null;
  }>
) => {
  const allInvoices = lines.every(
    (line) => line.purchaseOrderLineType === "Comment" || line.invoicedComplete
  );

  const allLinesReceived = lines.every(
    (line) => line.purchaseOrderLineType === "Comment" || line.receivedComplete
  );

  let status: Database["public"]["Tables"]["purchaseOrder"]["Row"]["status"] =
    "To Receive and Invoice";
  if (allInvoices && allLinesReceived) {
    status = "Completed";
  } else if (allInvoices) {
    status = "To Receive";
  } else if (allLinesReceived) {
    status = "To Invoice";
  }

  return { status, allInvoices, allLinesReceived };
};

export const getSalesOrderJobStatus = (
  jobs: SalesOrderJob[],
  line: SalesOrderLine
) => {
  const filteredJobs = jobs.filter((j) => j.salesOrderLineId === line.id);
  const isMade = line.methodType === "Make";
  const saleQuantity = line.saleQuantity ?? 0;

  const totalProduction = filteredJobs.reduce(
    (acc, job) => acc + job.productionQuantity,
    0
  );
  const totalCompleted = filteredJobs.reduce(
    (acc, job) => acc + job.quantityComplete,
    0
  );
  const totalReleased = filteredJobs.reduce((acc, job) => {
    if (job.status !== "Planned" && job.status !== "Draft") {
      return acc + job.productionQuantity;
    }
    return acc;
  }, 0);

  const hasEnoughJobsToCoverQuantity = totalProduction >= saleQuantity;
  const hasEnoughCompletedToCoverQuantity = totalCompleted >= saleQuantity;
  const hasAnyQuantityReleased = totalReleased > 0;
  const isCompleted =
    hasEnoughJobsToCoverQuantity && hasEnoughCompletedToCoverQuantity;
  const isPartiallyShipped =
    line.quantitySent > 0 && line.quantitySent < saleQuantity;

  let jobVariant: "green" | "red" | "orange";
  let jobLabel:
    | "Completed"
    | "Requires Jobs"
    | "In Progress"
    | "Planned"
    | "Shipped"
    | "Partially Shipped";

  if (isCompleted && line.sentComplete) {
    jobLabel = "Shipped";
    jobVariant = "green";
  } else if (isCompleted) {
    jobLabel = "Completed";
    jobVariant = "green";
  } else if (isPartiallyShipped) {
    jobLabel = "Partially Shipped";
    jobVariant = "orange";
  } else if (isMade && filteredJobs.length === 0) {
    jobLabel = "Requires Jobs";
    jobVariant = "red";
  } else if (hasAnyQuantityReleased) {
    jobLabel = "In Progress";
    jobVariant = "orange";
  } else {
    jobLabel = "Planned";
    jobVariant = "orange";
  }

  return { jobVariant, jobLabel, jobs: filteredJobs };
};
