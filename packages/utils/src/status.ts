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
    (line) =>
      line.salesOrderLineType === "Comment" ||
      // Services are never shipped — they can't block shipping completeness
      line.salesOrderLineType === "Service" ||
      line.sentComplete
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
    (line) =>
      line.purchaseOrderLineType === "Comment" ||
      line.purchaseOrderLineType === "G/L Account" ||
      // Services are never received — they can't block receipt completeness
      line.purchaseOrderLineType === "Service" ||
      line.receivedComplete
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
  jobs: SalesOrderJob[] | undefined,
  line: SalesOrderLine
) => {
  const filteredJobs =
    jobs?.filter((j) => j.salesOrderLineId === line.id) ?? [];
  const isMade = line.methodType === "Make to Order";
  const saleQuantity = line.saleQuantity ?? 0;

  const totalProduction = filteredJobs.reduce(
    (acc, job) => acc + (job.productionQuantity ?? 0),
    0
  );
  const totalCompleted = filteredJobs.reduce(
    (acc, job) => acc + job.quantityComplete,
    0
  );
  const totalReleased = filteredJobs.reduce((acc, job) => {
    if (job.status !== "Planned" && job.status !== "Draft") {
      return acc + (job.productionQuantity ?? 0);
    }
    return acc;
  }, 0);

  const hasEnoughJobsToCoverQuantity = totalProduction >= saleQuantity;
  const hasEnoughCompletedToCoverQuantity = totalCompleted >= saleQuantity;
  const hasAnyQuantityReleased = totalReleased > 0;
  const isCompleted =
    hasEnoughJobsToCoverQuantity && hasEnoughCompletedToCoverQuantity;
  const quantitySent = line.quantitySent ?? 0;
  const isPartiallyShipped = quantitySent > 0 && quantitySent < saleQuantity;

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

type SalesOrderForProductionCheck = {
  jobs?: Array<{
    salesOrderLineId: string;
    productionQuantity: number;
    quantityComplete: number;
    status: string;
  }>;
  lines?: Array<{
    id: string;
    methodType: "Purchase to Order" | "Make to Order" | "Pull from Inventory";
    saleQuantity: number;
  }>;
};

/**
 * Checks if a Sales Order has incomplete jobs.
 * Returns true if any "Make" line item has incomplete jobs.
 * A job is considered complete when quantityComplete >= saleQuantity for that line.
 */
export const hasIncompleteJobs = (
  salesOrder: SalesOrderForProductionCheck
): boolean => {
  const jobs = salesOrder.jobs ?? [];
  const lines = salesOrder.lines ?? [];

  const makeLines = lines.filter((line) => line.methodType === "Make to Order");
  if (makeLines.length === 0) {
    return false;
  }

  for (const line of makeLines) {
    const lineJobs = jobs.filter((job) => job.salesOrderLineId === line.id);
    if (lineJobs.length === 0) {
      return true;
    }

    const totalCompleted = lineJobs.reduce(
      (acc, job) => acc + (job.quantityComplete ?? 0),
      0
    );
    if (totalCompleted < (line.saleQuantity ?? 0)) {
      return true;
    }
  }

  return false;
};
