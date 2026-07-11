import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  isReminderItemStatus,
  NotificationEmail,
  type ReminderItemStatus,
  WeeklyReminderEmail
} from "@carbon/documents/email";
import { ERP_URL } from "@carbon/env";
import {
  type NotificationDetail,
  NotificationEvent
} from "@carbon/notifications";

type ApprovalDocumentType = Database["public"]["Enums"]["approvalDocumentType"];

// The ERP's /api/link route resolves event + documentId to the right page
// (switching the user's active company first) — route shapes never leak here.
export function buildNotificationLink(
  event: NotificationEvent,
  documentId: string,
  companyId: string,
  documentType?: ApprovalDocumentType
): string {
  const params = new URLSearchParams({ event, documentId, companyId });
  if (documentType) params.set("documentType", documentType);
  return `${ERP_URL}/api/link?${params.toString()}`;
}

// One document inside a digest-shaped notification. documentId + description
// drive the in-app child rows; the rest renders in the digest email.
export type DigestItem = {
  documentId: string;
  // Full sentence for the in-app child row.
  description: string;
  title: string;
  status?: ReminderItemStatus;
  detail?: string;
  url?: string;
  // Recurrence period ("2026", "Q3-2026") — scopes delivery tracking so the
  // cap resets each period. Absent for one-shot documents (frequency "Once").
  period?: string;
};

export type NotificationContent = {
  // Full sentence ("Job J00105 assigned to you") — subject / in-app / Slack.
  description: string;
  // Bare record id ("J00105") rendered prominently in the email body.
  // Undefined for events with no clean readable id (the description names
  // them instead).
  reference?: string;
  details: NotificationDetail[];
  // Present when the notification covers multiple documents: email renders a
  // digest template, in-app writes an expandable Digest parent + child rows.
  digest?: {
    items: DigestItem[];
  };
};

// Format an ISO date column for a detail row ("Aug 14, 2026"). Returns null for
// missing/invalid values so the row is dropped rather than shown blank.
export function formatDetailDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Date-only columns parse as UTC midnight; format in UTC so the rendered
  // date never shifts a day based on the server's local timezone.
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric"
  });
}

// Format a monetary amount for a detail row using the document's currency.
export function formatDetailAmount(
  amount: number | null | undefined,
  currencyCode: string | null | undefined
): string | null {
  if (amount === null || amount === undefined) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      currency: currencyCode || "USD",
      style: "currency"
    }).format(amount);
  } catch {
    return amount.toLocaleString("en-US", { minimumFractionDigits: 2 });
  }
}

// Build a details array, dropping any row whose value is missing/empty so the
// email/slack/in-app never render a label with a blank value.
export function buildDetails(
  rows: Array<{ label: string; value: string | null | undefined }>
): NotificationDetail[] {
  const details: NotificationDetail[] = [];
  for (const row of rows) {
    if (row.value) details.push({ label: row.label, value: row.value });
  }
  return details;
}

// Per-event description + detail rows, shared by email, Slack, and in-app.
// EventContentOptions carries the digest document set and the recipient needed
// to resolve per-document state.
type EventContentOptions = {
  companyId: string;
  documentIds?: string[];
  userId?: string;
};

async function buildEventContent(
  client: ReturnType<typeof getCarbonServiceRole>,
  type: NotificationEvent,
  documentId: string,
  documentType?: ApprovalDocumentType,
  opts?: EventContentOptions
): Promise<NotificationContent | null> {
  switch (type) {
    case NotificationEvent.SalesRfqReady:
    case NotificationEvent.SalesRfqAssignment: {
      const salesRfq = await client
        .from("salesRfq")
        .select("*, customer(name)")
        .eq("id", documentId)
        .single();

      if (salesRfq.error) {
        console.error("Failed to get salesRfq", salesRfq.error);
        throw salesRfq.error;
      }

      const baseDetails = [
        { label: "Customer", value: salesRfq.data?.customer?.name },
        { label: "Customer ref", value: salesRfq.data?.customerReference },
        {
          label: "Expires",
          value: formatDetailDate(salesRfq.data?.expirationDate)
        }
      ];

      if (type === NotificationEvent.SalesRfqReady) {
        // No Status row — the notification already says it's ready for quote.
        return {
          description: `RFQ ${salesRfq?.data?.rfqId} is ready for quote`,
          reference: salesRfq?.data?.rfqId ?? undefined,
          details: buildDetails(baseDetails)
        };
      } else if (type === NotificationEvent.SalesRfqAssignment) {
        return {
          description: `RFQ ${salesRfq?.data?.rfqId} assigned to you`,
          reference: salesRfq?.data?.rfqId ?? undefined,
          details: buildDetails([
            ...baseDetails,
            { label: "Status", value: salesRfq.data?.status }
          ])
        };
      }
      return null;
    }

    case NotificationEvent.QuoteAssignment: {
      const quote = await client
        .from("quote")
        .select("*, customer(name)")
        .eq("id", documentId)
        .single();
      if (quote.error) {
        console.error("Failed to get quote", quote.error);
        throw quote.error;
      }
      return {
        description: `Quote ${quote?.data?.quoteId} assigned to you`,
        reference: quote?.data?.quoteId ?? undefined,
        details: buildDetails([
          { label: "Customer", value: quote.data?.customer?.name },
          { label: "Customer ref", value: quote.data?.customerReference },
          {
            label: "Expires",
            value: formatDetailDate(quote.data?.expirationDate)
          },
          { label: "Status", value: quote.data?.status }
        ])
      };
    }

    case NotificationEvent.QuoteExpired: {
      const expiredQuote = await client
        .from("quote")
        .select("*, customer(name)")
        .eq("id", documentId)
        .single();
      if (expiredQuote.error) {
        console.error("Failed to get quote", expiredQuote.error);
        throw expiredQuote.error;
      }
      return {
        description: `Quote ${expiredQuote?.data?.quoteId} has expired`,
        reference: expiredQuote?.data?.quoteId ?? undefined,
        details: buildDetails([
          { label: "Customer", value: expiredQuote.data?.customer?.name },
          {
            label: "Customer ref",
            value: expiredQuote.data?.customerReference
          },
          {
            label: "Expired",
            value: formatDetailDate(expiredQuote.data?.expirationDate)
          }
        ])
      };
    }

    case NotificationEvent.SalesOrderAssignment: {
      const salesOrder = await client
        .from("salesOrder")
        .select("*, customer(name)")
        .eq("id", documentId)
        .single();

      if (salesOrder.error) {
        console.error("Failed to get salesOrder", salesOrder.error);
        throw salesOrder.error;
      }

      return {
        description: `Sales Order ${salesOrder?.data?.salesOrderId} assigned to you`,
        reference: salesOrder?.data?.salesOrderId ?? undefined,
        details: buildDetails([
          { label: "Customer", value: salesOrder.data?.customer?.name },
          {
            label: "Customer ref",
            value: salesOrder.data?.customerReference
          },
          {
            label: "Order date",
            value: formatDetailDate(salesOrder.data?.orderDate)
          },
          { label: "Status", value: salesOrder.data?.status }
        ])
      };
    }

    case NotificationEvent.MaintenanceDispatchCreated: {
      const maintenanceDispatchCreated = await client
        .from("maintenanceDispatch")
        .select("*, workCenter(name)")
        .eq("id", documentId)
        .single();

      if (maintenanceDispatchCreated.error) {
        console.error(
          "Failed to get maintenanceDispatchCreated",
          maintenanceDispatchCreated.error
        );
        throw maintenanceDispatchCreated.error;
      }

      return {
        description: `New maintenance dispatch ${maintenanceDispatchCreated?.data?.maintenanceDispatchId} created`,
        reference:
          maintenanceDispatchCreated?.data?.maintenanceDispatchId ?? undefined,
        details: buildDetails([
          {
            label: "Work center",
            value: maintenanceDispatchCreated.data?.workCenter?.name
          },
          {
            label: "Priority",
            value: maintenanceDispatchCreated.data?.priority
          },
          {
            label: "Severity",
            value: maintenanceDispatchCreated.data?.severity
          },
          { label: "Status", value: maintenanceDispatchCreated.data?.status }
        ])
      };
    }

    case NotificationEvent.MaintenanceDispatchAssignment: {
      const maintenanceDispatch = await client
        .from("maintenanceDispatch")
        .select("*, workCenter(id, name)")
        .eq("id", documentId)
        .single();

      if (maintenanceDispatch.error) {
        console.error(
          "Failed to get maintenanceDispatch",
          maintenanceDispatch.error
        );
        throw maintenanceDispatch.error;
      }

      const workCenterName =
        maintenanceDispatch.data?.workCenter?.name ?? "Unknown";
      const dispatchId =
        maintenanceDispatch.data?.maintenanceDispatchId ?? documentId;
      return {
        description: `Maintenance dispatch ${dispatchId} for ${workCenterName} assigned to you`,
        reference: dispatchId,
        details: buildDetails([
          { label: "Priority", value: maintenanceDispatch.data?.priority },
          { label: "Severity", value: maintenanceDispatch.data?.severity },
          { label: "Status", value: maintenanceDispatch.data?.status }
        ])
      };
    }

    case NotificationEvent.NonConformanceAssignment: {
      const nonConformance = await client
        .from("nonConformance")
        .select("*, location(name)")
        .eq("id", documentId)
        .single();

      if (nonConformance.error) {
        console.error("Failed to get nonConformance", nonConformance.error);
        throw nonConformance.error;
      }

      return {
        description: `Issue ${nonConformance?.data?.nonConformanceId} assigned to you`,
        reference: nonConformance?.data?.nonConformanceId ?? undefined,
        details: buildDetails([
          { label: "Priority", value: nonConformance.data?.priority },
          { label: "Status", value: nonConformance.data?.status },
          {
            label: "Due",
            value: formatDetailDate(nonConformance.data?.dueDate)
          },
          { label: "Location", value: nonConformance.data?.location?.name }
        ])
      };
    }

    case NotificationEvent.JobAssignment: {
      const job = await client
        .from("job")
        .select("*, customer(name), item(readableId, name)")
        .eq("id", documentId)
        .single();

      if (job.error) {
        console.error("Failed to get job", job.error);
        throw job.error;
      }

      return {
        description: `Job ${job?.data?.jobId} assigned to you`,
        reference: job?.data?.jobId ?? undefined,
        details: buildDetails([
          {
            label: "Part",
            value: job.data?.item?.readableId ?? job.data?.item?.name
          },
          { label: "Quantity", value: job.data?.quantity?.toString() },
          { label: "Due", value: formatDetailDate(job.data?.dueDate) },
          { label: "Customer", value: job.data?.customer?.name }
        ])
      };
    }

    case NotificationEvent.JobCompleted: {
      const completedJob = await client
        .from("job")
        .select("*, customer(name), item(readableId, name)")
        .eq("id", documentId)
        .single();

      if (completedJob.error) {
        console.error("Failed to get job", completedJob.error);
        throw completedJob.error;
      }

      return {
        description: `Job ${completedJob?.data?.jobId} is complete!`,
        reference: completedJob?.data?.jobId ?? undefined,
        details: buildDetails([
          {
            label: "Part",
            value:
              completedJob.data?.item?.readableId ??
              completedJob.data?.item?.name
          },
          {
            label: "Completed",
            value: completedJob.data?.quantityComplete?.toString()
          },
          { label: "Customer", value: completedJob.data?.customer?.name }
        ])
      };
    }

    case NotificationEvent.JobOperationAssignment:
    case NotificationEvent.JobOperationMessage: {
      const [, operationId] = documentId.split(":");
      const jobOperation = await client
        .from("jobOperation")
        .select("*, job(id, jobId), workCenter(name)")
        .eq("id", operationId!)
        .single();

      if (jobOperation.error) {
        console.error("Failed to get jobOperation", jobOperation.error);
        throw jobOperation.error;
      }

      const details = buildDetails([
        { label: "Work center", value: jobOperation.data?.workCenter?.name },
        { label: "Due", value: formatDetailDate(jobOperation.data?.dueDate) },
        { label: "Status", value: jobOperation.data?.status }
      ]);

      if (type === NotificationEvent.JobOperationAssignment) {
        return {
          description: `New job operation assigned to you on ${jobOperation?.data?.job?.jobId}`,
          reference: jobOperation?.data?.job?.jobId ?? undefined,
          details
        };
      } else if (type === NotificationEvent.JobOperationMessage) {
        return {
          description: `New message on ${jobOperation?.data?.job?.jobId} operation: ${jobOperation?.data?.description}`,
          reference: jobOperation?.data?.job?.jobId ?? undefined,
          // The email body shows the reference (job id), so surface the message
          // text itself as a row — otherwise it's only in the subject.
          details: buildDetails([
            { label: "Message", value: jobOperation.data?.description },
            ...details
          ])
        };
      }
      return null;
    }

    case NotificationEvent.ProcedureAssignment: {
      const procedure = await client
        .from("procedure")
        .select("name, version, status, process(name)")
        .eq("id", documentId)
        .single();

      if (procedure.error) {
        console.error("Failed to get procedure", procedure.error);
        throw procedure.error;
      }

      return {
        description: `Procedure ${procedure?.data?.name} version ${procedure?.data?.version} assigned to you`,
        reference: procedure.data?.name ?? undefined,
        details: buildDetails([
          {
            label: "Version",
            value:
              procedure.data?.version != null
                ? `v${procedure.data.version}`
                : null
          },
          { label: "Status", value: procedure.data?.status },
          { label: "Process", value: procedure.data?.process?.name }
        ])
      };
    }

    case NotificationEvent.DigitalQuoteResponse: {
      const digitalQuote = await client
        .from("quote")
        .select("*, customer(name)")
        .eq("id", documentId)
        .single();

      if (digitalQuote.error) {
        console.error("Failed to get digital quote", digitalQuote.error);
        throw digitalQuote.error;
      }

      // The email body renders the reference (quote id), so the outcome must
      // be a detail row — otherwise accepted vs rejected is only visible in
      // the subject line.
      const response = digitalQuote.data.digitalQuoteAcceptedBy
        ? `Completed by ${digitalQuote.data.digitalQuoteAcceptedBy}`
        : digitalQuote.data.digitalQuoteRejectedBy
          ? `Rejected by ${digitalQuote.data.digitalQuoteRejectedBy}`
          : "Accepted";

      const details = buildDetails([
        { label: "Response", value: response },
        { label: "Customer", value: digitalQuote.data?.customer?.name },
        {
          label: "Customer ref",
          value: digitalQuote.data?.customerReference
        },
        {
          label: "Expires",
          value: formatDetailDate(digitalQuote.data?.expirationDate)
        },
        { label: "Status", value: digitalQuote.data?.status }
      ]);
      const reference = digitalQuote?.data?.quoteId ?? undefined;

      if (digitalQuote.data.digitalQuoteAcceptedBy) {
        return {
          description: `Digital Quote ${digitalQuote?.data?.quoteId} was completed by ${digitalQuote.data.digitalQuoteAcceptedBy}`,
          reference,
          details
        };
      }

      if (digitalQuote.data.digitalQuoteRejectedBy) {
        return {
          description: `Digital Quote ${digitalQuote?.data?.quoteId} was rejected by ${digitalQuote.data.digitalQuoteRejectedBy}`,
          reference,
          details
        };
      }

      return {
        description: `Digital Quote ${digitalQuote?.data?.quoteId} was accepted`,
        reference,
        details
      };
    }

    case NotificationEvent.GaugeCalibrationExpired: {
      // documentId is a `gauge` row id (see scheduled/cleanup.ts), NOT a
      // gaugeCalibrationRecord id — query the gauge for its readable id and
      // calibration dates.
      const gauge = await client
        .from("gauge")
        .select(
          "gaugeId, description, gaugeCalibrationStatus, lastCalibrationDate, nextCalibrationDate"
        )
        .eq("id", documentId)
        .single();

      if (gauge.error) {
        console.error("Failed to get gauge", gauge.error);
        throw gauge.error;
      }

      return {
        description: `Gauge ${gauge.data?.gaugeId} is out of calibration`,
        reference: gauge.data?.gaugeId ?? undefined,
        details: buildDetails([
          { label: "Description", value: gauge.data?.description },
          {
            label: "Last calibrated",
            value: formatDetailDate(gauge.data?.lastCalibrationDate)
          },
          {
            label: "Due",
            value: formatDetailDate(gauge.data?.nextCalibrationDate)
          },
          { label: "Status", value: gauge.data?.gaugeCalibrationStatus }
        ])
      };
    }

    case NotificationEvent.StockTransferAssignment: {
      const stockTransfer = await client
        .from("stockTransfer")
        .select("*, location(name)")
        .eq("id", documentId)
        .single();

      if (stockTransfer.error) {
        console.error("Failed to get stockTransfer", stockTransfer.error);
        throw stockTransfer.error;
      }

      // Number of line items to move — the header only has one location, so the
      // count is the most useful "how big is this transfer" signal.
      const { count: lineCount } = await client
        .from("stockTransferLine")
        .select("id", { count: "exact", head: true })
        .eq("stockTransferId", documentId);

      return {
        description: `Stock Transfer ${stockTransfer?.data?.stockTransferId} assigned to you`,
        reference: stockTransfer?.data?.stockTransferId ?? undefined,
        details: buildDetails([
          { label: "Location", value: stockTransfer.data?.location?.name },
          {
            label: "Items",
            value: lineCount != null ? String(lineCount) : null
          },
          { label: "Status", value: stockTransfer.data?.status }
        ])
      };
    }

    case NotificationEvent.PickingListAssignment: {
      const pickingList = await client
        .from("pickingList")
        .select("*, location(name)")
        .eq("id", documentId)
        .single();

      if (pickingList.error) {
        console.error("Failed to get pickingList", pickingList.error);
        throw pickingList.error;
      }

      return {
        description: `Picking List ${pickingList?.data?.pickingListId} assigned to you`,
        reference: pickingList?.data?.pickingListId ?? undefined,
        details: buildDetails([
          { label: "Location", value: pickingList.data?.location?.name },
          { label: "Due", value: formatDetailDate(pickingList.data?.dueDate) },
          { label: "Status", value: pickingList.data?.status }
        ])
      };
    }

    case NotificationEvent.TrainingAssignment: {
      const trainingAssignment = await client
        .from("trainingAssignment")
        .select("*, training(id, name, type, frequency, estimatedDuration)")
        .eq("id", documentId)
        .single();

      if (trainingAssignment.error) {
        console.error(
          "Failed to get trainingAssignment",
          trainingAssignment.error
        );
        throw trainingAssignment.error;
      }

      // Assigned-to-you training (vs ResourceTrainingAssignment, which
      // announces a newly available one).
      const trainingName = trainingAssignment?.data?.training?.name;
      return {
        description: `Training "${trainingName}" assigned to you`,
        reference: trainingName ?? undefined,
        details: buildDetails([
          { label: "Type", value: trainingAssignment.data?.training?.type },
          {
            label: "Frequency",
            value: trainingAssignment.data?.training?.frequency
          },
          {
            label: "Duration",
            value: trainingAssignment.data?.training?.estimatedDuration
          }
        ])
      };
    }

    case NotificationEvent.TrainingReminder: {
      // One digest-shaped notification covering all of the recipient's
      // outstanding trainings (payload.documentIds).
      const ids = opts?.documentIds?.length ? opts.documentIds : [documentId];

      const assignments = await client
        .from("trainingAssignment")
        .select("id, training(id, name, type, frequency, estimatedDuration)")
        .in("id", ids);

      if (assignments.error) {
        console.error("Failed to get trainingAssignments", assignments.error);
        throw assignments.error;
      }
      const rows = assignments.data ?? [];
      if (rows.length === 0) return null;

      // Status from the same RPC the weekly job uses; a missing row (e.g.
      // completed in flight) renders without a status label.
      const statusByAssignment = new Map<string, ReminderItemStatus>();
      const periodByAssignment = new Map<string, string>();
      if (opts?.userId) {
        // p_employee_id (migration 20260702205625) scopes the RPC to this
        // recipient; drop the cast once db:migrate regenerates the DB types.
        const rpcArgs = {
          p_company_id: opts.companyId,
          p_employee_id: opts.userId
        } as unknown as { p_company_id: string };
        const status = await client.rpc(
          "get_training_assignment_status",
          rpcArgs
        );
        if (status.error) {
          console.error(
            "Failed to get training assignment status",
            status.error
          );
        } else {
          for (const row of status.data ?? []) {
            if (row.employeeId !== opts.userId) continue;
            if (!ids.includes(row.trainingAssignmentId)) continue;
            if (row.currentPeriod) {
              periodByAssignment.set(
                row.trainingAssignmentId,
                row.currentPeriod
              );
            }
            if (!isReminderItemStatus(row.status)) continue;
            // Overdue always wins; Pending only fills an empty slot.
            if (
              row.status === "Overdue" ||
              !statusByAssignment.has(row.trainingAssignmentId)
            ) {
              statusByAssignment.set(row.trainingAssignmentId, row.status);
            }
          }
        }
      }

      const items: DigestItem[] = rows.map((assignment) => {
        const title = assignment.training?.name ?? "Training";
        return {
          description: `Training "${title}" is still outstanding`,
          detail: [
            assignment.training?.type,
            assignment.training?.frequency,
            assignment.training?.estimatedDuration
          ]
            .filter(Boolean)
            .join(" · "),
          documentId: assignment.id,
          period: periodByAssignment.get(assignment.id),
          status: statusByAssignment.get(assignment.id),
          title,
          url: opts?.companyId
            ? buildNotificationLink(
                NotificationEvent.TrainingReminder,
                assignment.id,
                opts.companyId
              )
            : undefined
        };
      });

      const count = items.length;
      return {
        description: `You have ${count} outstanding training${
          count === 1 ? "" : "s"
        }`,
        details: buildDetails(
          items.map((item) => ({
            label: item.title,
            value: item.status ?? "Outstanding"
          }))
        ),
        digest: { items }
      };
    }

    case NotificationEvent.ResourceTrainingAssignment: {
      const training = await client
        .from("training")
        .select("name, type, status, version")
        .eq("id", documentId)
        .single();

      if (training.error) {
        console.error("Failed to get training", training.error);
        throw training.error;
      }

      // A newly available training (vs TrainingAssignment, which is a training
      // assigned to a specific person/group to complete).
      return {
        description: `New training available: "${training?.data?.name}"`,
        reference: training.data?.name ?? undefined,
        details: buildDetails([
          { label: "Type", value: training.data?.type },
          { label: "Status", value: training.data?.status },
          {
            label: "Version",
            value:
              training.data?.version != null
                ? `v${training.data.version}`
                : null
          }
        ])
      };
    }

    case NotificationEvent.PurchaseOrderAssignment: {
      const purchaseOrder = await client
        .from("purchaseOrder")
        .select("*, supplier(name)")
        .eq("id", documentId)
        .single();

      if (purchaseOrder.error) {
        console.error("Failed to get purchaseOrder", purchaseOrder.error);
        throw purchaseOrder.error;
      }

      return {
        description: `Purchase Order ${purchaseOrder?.data?.purchaseOrderId} assigned to you`,
        reference: purchaseOrder?.data?.purchaseOrderId ?? undefined,
        details: buildDetails([
          { label: "Supplier", value: purchaseOrder.data?.supplier?.name },
          {
            label: "Supplier ref",
            value: purchaseOrder.data?.supplierReference
          },
          {
            label: "Order date",
            value: formatDetailDate(purchaseOrder.data?.orderDate)
          },
          { label: "Status", value: purchaseOrder.data?.status }
        ])
      };
    }

    case NotificationEvent.PurchaseInvoiceAssignment: {
      const purchaseInvoice = await client
        .from("purchaseInvoice")
        .select("*, supplier!purchaseInvoice_supplierId_fkey(name)")
        .eq("id", documentId)
        .single();

      if (purchaseInvoice.error) {
        console.error("Failed to get purchaseInvoice", purchaseInvoice.error);
        throw purchaseInvoice.error;
      }

      return {
        description: `Purchase Invoice ${purchaseInvoice?.data?.invoiceId} assigned to you`,
        reference: purchaseInvoice?.data?.invoiceId ?? undefined,
        details: buildDetails([
          { label: "Supplier", value: purchaseInvoice.data?.supplier?.name },
          {
            label: "Amount",
            value: formatDetailAmount(
              purchaseInvoice.data?.totalAmount,
              purchaseInvoice.data?.currencyCode
            )
          },
          { label: "Status", value: purchaseInvoice.data?.status }
        ])
      };
    }

    case NotificationEvent.SuggestionResponse: {
      const suggestion = await client
        .from("suggestion")
        .select("*, user(id, fullName)")
        .eq("id", documentId)
        .single();

      if (suggestion.error) {
        console.error("Failed to get suggestion", suggestion.error);
        throw suggestion.error;
      }

      const submittedBy = suggestion.data.user?.fullName || "Anonymous";
      return {
        description: `New suggestion submitted by ${submittedBy}`,
        details: buildDetails([
          { label: "Suggestion", value: suggestion.data?.suggestion },
          { label: "Page", value: suggestion.data?.path }
        ])
      };
    }

    case NotificationEvent.RiskAssignment: {
      const risk = await client
        .from("riskRegister")
        .select("title, type, source, status, severity, likelihood")
        .eq("id", documentId)
        .single();

      if (risk.error) {
        console.error("Failed to get risk", risk.error);
        throw risk.error;
      }

      return {
        description: `Risk "${risk?.data?.title}" assigned to you`,
        reference: risk.data?.title ?? undefined,
        details: buildDetails([
          { label: "Type", value: risk.data?.type },
          { label: "Source", value: risk.data?.source },
          {
            label: "Severity",
            value:
              risk.data?.severity != null ? `${risk.data.severity} / 5` : null
          },
          {
            label: "Likelihood",
            value:
              risk.data?.likelihood != null
                ? `${risk.data.likelihood} / 5`
                : null
          },
          { label: "Status", value: risk.data?.status }
        ])
      };
    }

    case NotificationEvent.SupplierQuoteAssignment: {
      const supplierQuoteAssignment = await client
        .from("supplierQuote")
        .select("*, supplier(name)")
        .eq("id", documentId)
        .single();

      if (supplierQuoteAssignment.error) {
        console.error(
          "Failed to get supplier quote",
          supplierQuoteAssignment.error
        );
        throw supplierQuoteAssignment.error;
      }

      return {
        description: `Supplier Quote ${supplierQuoteAssignment?.data?.supplierQuoteId} assigned to you`,
        reference: supplierQuoteAssignment?.data?.supplierQuoteId ?? undefined,
        details: buildDetails([
          {
            label: "Supplier",
            value: supplierQuoteAssignment.data?.supplier?.name
          },
          {
            label: "Expires",
            value: formatDetailDate(
              supplierQuoteAssignment.data?.expirationDate
            )
          },
          { label: "Status", value: supplierQuoteAssignment.data?.status }
        ])
      };
    }

    case NotificationEvent.SupplierQuoteResponse: {
      const supplierQuote = await client
        .from("supplierQuote")
        .select("*, supplier(name)")
        .eq("id", documentId)
        .single();

      if (supplierQuote.error) {
        console.error("Failed to get supplier quote", supplierQuote.error);
        throw supplierQuote.error;
      }

      const externalNotes = supplierQuote.data.externalNotes as Record<
        string,
        unknown
      > | null;
      const respondedBy =
        (externalNotes?.lastSubmittedBy as string | undefined) || "Supplier";
      return {
        description: `Supplier Quote ${supplierQuote?.data?.supplierQuoteId} was submitted by ${respondedBy}`,
        reference: supplierQuote?.data?.supplierQuoteId ?? undefined,
        // No Status row — a submitted supplier quote is always "Active", so it
        // adds nothing to a "was submitted" notification. "Submitted by" is a
        // row because the email body shows the reference, not the sentence.
        details: buildDetails([
          { label: "Submitted by", value: respondedBy },
          { label: "Supplier", value: supplierQuote.data?.supplier?.name },
          {
            label: "Supplier ref",
            value: supplierQuote.data?.supplierReference
          },
          {
            label: "Expires",
            value: formatDetailDate(supplierQuote.data?.expirationDate)
          }
        ])
      };
    }

    case NotificationEvent.ApprovalRequested:
    case NotificationEvent.ApprovalApproved:
    case NotificationEvent.ApprovalRejected: {
      // One shape for all three approval outcomes: the same document details,
      // only the action phrasing differs. The actor ("Requested/Approved/
      // Rejected by") is appended later by getNotificationContent.
      const outcome =
        type === NotificationEvent.ApprovalRequested
          ? "requested"
          : type === NotificationEvent.ApprovalApproved
            ? "approved"
            : "rejected";
      const poPhrase =
        outcome === "requested" ? "requires your approval" : `was ${outcome}`;
      const docPhrase = poPhrase;

      if (documentType === "purchaseOrder") {
        const po = await client
          .from("purchaseOrder")
          .select("purchaseOrderId, supplierReference, status, supplier(name)")
          .eq("id", documentId)
          .single();

        if (po.error || !po.data) {
          console.error(
            "Failed to retrieve purchase order for approval notification",
            po.error
          );
          return {
            description: `Purchase order ${poPhrase}`,
            details: []
          };
        }

        return {
          description: `Purchase order ${po.data.purchaseOrderId} ${poPhrase}`,
          reference: po.data.purchaseOrderId ?? undefined,
          details: buildDetails([
            { label: "Supplier", value: po.data.supplier?.name },
            { label: "Supplier ref", value: po.data.supplierReference },
            { label: "Status", value: po.data.status }
          ])
        };
      }

      if (documentType === "qualityDocument") {
        const qd = await client
          .from("qualityDocument")
          .select("name, status, version")
          .eq("id", documentId)
          .single();

        if (qd.error || !qd.data) {
          console.error(
            "Failed to retrieve quality document for approval notification",
            qd.error
          );
          return {
            description: `Quality document ${docPhrase}`,
            details: []
          };
        }

        return {
          description: `Quality document "${qd.data.name ?? "Untitled"}" ${docPhrase}`,
          details: buildDetails([
            {
              label: "Version",
              value: qd.data.version != null ? `v${qd.data.version}` : null
            },
            { label: "Status", value: qd.data.status }
          ])
        };
      }

      return {
        description:
          outcome === "requested"
            ? "Approval requested"
            : `Your approval request was ${outcome}`,
        details: []
      };
    }

    default:
      return null;
  }
}

// The label for the "who did this" detail row, derived from the event. Every
// `*-assignment` event is "Assigned by"; approvals name the actor by the action
// they took. Returns null for events where the sender isn't worth surfacing
// (the description already names them, e.g. suggestions).
// Events where `from` is the assigner. Deliberately explicit: TrainingReminder
// is a system nudge and must NOT inherit "Assigned by".
const assignmentEvents = new Set<NotificationEvent>([
  NotificationEvent.JobAssignment,
  NotificationEvent.JobOperationAssignment,
  NotificationEvent.MaintenanceDispatchAssignment,
  NotificationEvent.NonConformanceAssignment,
  NotificationEvent.PickingListAssignment,
  NotificationEvent.ProcedureAssignment,
  NotificationEvent.PurchaseInvoiceAssignment,
  NotificationEvent.PurchaseOrderAssignment,
  NotificationEvent.QuoteAssignment,
  NotificationEvent.ResourceTrainingAssignment,
  NotificationEvent.RiskAssignment,
  NotificationEvent.SalesOrderAssignment,
  NotificationEvent.SalesRfqAssignment,
  NotificationEvent.StockTransferAssignment,
  NotificationEvent.SupplierQuoteAssignment,
  NotificationEvent.TrainingAssignment
]);

export function getActorLabel(type: NotificationEvent): string | null {
  if (assignmentEvents.has(type)) return "Assigned by";
  switch (type) {
    case NotificationEvent.ApprovalRequested:
      return "Requested by";
    case NotificationEvent.ApprovalApproved:
      return "Approved by";
    case NotificationEvent.ApprovalRejected:
      return "Rejected by";
    case NotificationEvent.MaintenanceDispatchCreated:
      return "Created by";
    default:
      return null;
  }
}

// Adds the "who did this" row (from = assigner/requester/approver/rejecter).
// The sender is filtered out of recipients upstream.
export async function getNotificationContent(
  client: ReturnType<typeof getCarbonServiceRole>,
  type: NotificationEvent,
  documentId: string,
  from: string | undefined,
  documentType?: ApprovalDocumentType,
  opts?: EventContentOptions
): Promise<NotificationContent | null> {
  const content = await buildEventContent(
    client,
    type,
    documentId,
    documentType,
    opts
  );
  if (!content) return content;

  const actorLabel = getActorLabel(type);
  if (from && actorLabel) {
    const actor = await client
      .from("user")
      .select("fullName")
      .eq("id", from)
      .single();
    if (actor.data?.fullName) {
      content.details.push({
        label: actorLabel,
        value: actor.data.fullName
      });
    }
  }

  return content;
}

// Template dispatch: add a case to give a notification type its own email;
// everything else renders the generic NotificationEmail card.
export function getNotificationEmailComponent(args: {
  content: NotificationContent;
  ctaLabel: string;
  ctaUrl: string;
  event: NotificationEvent;
  heading: string;
  recipientName?: string;
}) {
  switch (args.event) {
    case NotificationEvent.TrainingReminder:
      return WeeklyReminderEmail({
        // Per-item links are the actions; suppress the bottom CTA.
        ctaUrl: "",
        heading: "Your weekly reminders",
        items: args.content.digest?.items ?? [],
        message: `${args.content.description} to complete.`,
        preview: args.content.description,
        recipientName: args.recipientName
      });
    default:
      return NotificationEmail({
        ctaLabel: args.ctaLabel,
        ctaUrl: args.ctaUrl,
        details: args.content.details,
        heading: args.heading,
        message: args.content.description,
        preview: args.heading,
        recipientName: args.recipientName,
        reference: args.content.reference
      });
  }
}
