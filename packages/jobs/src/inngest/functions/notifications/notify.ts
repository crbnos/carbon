import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { NotificationEmail } from "@carbon/documents/email";
import {
  type CompanyIntegration,
  notifyTaskAssigned
} from "@carbon/ee/notifications";
import { companyHasPlan } from "@carbon/ee/plan.server";
import { getSlackUserIdByCarbonId } from "@carbon/ee/slack.server";
import { ERP_URL } from "@carbon/env";
import type { Events } from "@carbon/lib/events";
import {
  getNotificationEmailCtaLabel,
  getNotificationEmailHeading,
  getNotificationTopic,
  NotificationDestination,
  NotificationEvent
} from "@carbon/notifications";
import { render } from "@react-email/components";
import { inngest } from "../../client";

type ApprovalDocumentType = Database["public"]["Enums"]["approvalDocumentType"];

function buildNotificationLink(
  event: NotificationEvent,
  documentId: string,
  companyId: string,
  documentType?: ApprovalDocumentType
): string {
  const params = new URLSearchParams({ event, documentId, companyId });
  if (documentType) params.set("documentType", documentType);
  return `${ERP_URL}/api/link?${params.toString()}`;
}

async function getCompanyIntegrations(
  client: ReturnType<typeof getCarbonServiceRole>,
  companyId: string
) {
  return client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId);
}

async function getDescription(
  client: ReturnType<typeof getCarbonServiceRole>,
  type: NotificationEvent,
  documentId: string,
  documentType?: ApprovalDocumentType
): Promise<string | null> {
  switch (type) {
    case NotificationEvent.SalesRfqReady:
    case NotificationEvent.SalesRfqAssignment: {
      const salesRfq = await client
        .from("salesRfq")
        .select("*")
        .eq("id", documentId)
        .single();

      if (salesRfq.error) {
        console.error("Failed to get salesRfq", salesRfq.error);
        throw salesRfq.error;
      }

      if (type === NotificationEvent.SalesRfqReady) {
        return `RFQ ${salesRfq?.data?.rfqId} is ready for quote`;
      } else if (type === NotificationEvent.SalesRfqAssignment) {
        return `RFQ ${salesRfq?.data?.rfqId} assigned to you`;
      }
      return null;
    }

    case NotificationEvent.QuoteAssignment: {
      const quote = await client
        .from("quote")
        .select("*")
        .eq("id", documentId)
        .single();
      if (quote.error) {
        console.error("Failed to get quote", quote.error);
        throw quote.error;
      }
      return `Quote ${quote?.data?.quoteId} assigned to you`;
    }

    case NotificationEvent.QuoteExpired: {
      const expiredQuote = await client
        .from("quote")
        .select("*")
        .eq("id", documentId)
        .single();
      if (expiredQuote.error) {
        console.error("Failed to get quote", expiredQuote.error);
        throw expiredQuote.error;
      }
      return `Quote ${expiredQuote?.data?.quoteId} has expired`;
    }

    case NotificationEvent.SalesOrderAssignment: {
      const salesOrder = await client
        .from("salesOrder")
        .select("*")
        .eq("id", documentId)
        .single();

      if (salesOrder.error) {
        console.error("Failed to get salesOrder", salesOrder.error);
        throw salesOrder.error;
      }

      return `Sales Order ${salesOrder?.data?.salesOrderId} assigned to you`;
    }

    case NotificationEvent.MaintenanceDispatchCreated: {
      const maintenanceDispatchCreated = await client
        .from("maintenanceDispatch")
        .select("*")
        .eq("id", documentId)
        .single();

      if (maintenanceDispatchCreated.error) {
        console.error(
          "Failed to get maintenanceDispatchCreated",
          maintenanceDispatchCreated.error
        );
        throw maintenanceDispatchCreated.error;
      }

      return `New maintenance dispatch ${maintenanceDispatchCreated?.data?.maintenanceDispatchId} created`;
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
      return `Maintenance dispatch ${dispatchId} for ${workCenterName} assigned to you`;
    }

    case NotificationEvent.NonConformanceAssignment: {
      const nonConformance = await client
        .from("nonConformance")
        .select("*")
        .eq("id", documentId)
        .single();

      if (nonConformance.error) {
        console.error("Failed to get nonConformance", nonConformance.error);
        throw nonConformance.error;
      }

      return `Issue ${nonConformance?.data?.nonConformanceId} assigned to you`;
    }

    case NotificationEvent.JobAssignment: {
      const job = await client
        .from("job")
        .select("*")
        .eq("id", documentId)
        .single();

      if (job.error) {
        console.error("Failed to get job", job.error);
        throw job.error;
      }

      return `Job ${job?.data?.jobId} assigned to you`;
    }

    case NotificationEvent.JobCompleted: {
      const completedJob = await client
        .from("job")
        .select("*")
        .eq("id", documentId)
        .single();

      if (completedJob.error) {
        console.error("Failed to get job", completedJob.error);
        throw completedJob.error;
      }

      return `Job ${completedJob?.data?.jobId} is complete!`;
    }

    case NotificationEvent.JobOperationAssignment:
    case NotificationEvent.JobOperationMessage: {
      const [, operationId] = documentId.split(":");
      const jobOperation = await client
        .from("jobOperation")
        .select("*, job(id, jobId)")
        .eq("id", operationId!)
        .single();

      if (jobOperation.error) {
        console.error("Failed to get jobOperation", jobOperation.error);
        throw jobOperation.error;
      }

      if (type === NotificationEvent.JobOperationAssignment) {
        return `New job operation assigned to you on ${jobOperation?.data?.job?.jobId}`;
      } else if (type === NotificationEvent.JobOperationMessage) {
        return `New message on ${jobOperation?.data?.job?.jobId} operation: ${jobOperation?.data?.description}`;
      }
      return null;
    }

    case NotificationEvent.ProcedureAssignment: {
      const procedure = await client
        .from("procedure")
        .select("*")
        .eq("id", documentId)
        .single();

      if (procedure.error) {
        console.error("Failed to get procedure", procedure.error);
        throw procedure.error;
      }

      return `Procedure ${procedure?.data?.name} version ${procedure?.data?.version} assigned to you`;
    }

    case NotificationEvent.DigitalQuoteResponse: {
      const digitalQuote = await client
        .from("quote")
        .select("*")
        .eq("id", documentId)
        .single();

      if (digitalQuote.error) {
        console.error("Failed to get digital quote", digitalQuote.error);
        throw digitalQuote.error;
      }

      if (digitalQuote.data.digitalQuoteAcceptedBy) {
        return `Digital Quote ${digitalQuote?.data?.quoteId} was completed by ${digitalQuote.data.digitalQuoteAcceptedBy}`;
      }

      if (digitalQuote.data.digitalQuoteRejectedBy) {
        return `Digital Quote ${digitalQuote?.data?.quoteId} was rejected by ${digitalQuote.data.digitalQuoteRejectedBy}`;
      }

      return `Digital Quote ${digitalQuote?.data?.quoteId} was accepted`;
    }

    case NotificationEvent.GaugeCalibrationExpired: {
      const gaugeCalibration = await client
        .from("gaugeCalibrationRecord")
        .select("*")
        .eq("id", documentId)
        .single();

      if (gaugeCalibration.error) {
        console.error("Failed to get gaugeCalibration", gaugeCalibration.error);
        throw gaugeCalibration.error;
      }

      return `Gauge ${gaugeCalibration?.data?.gaugeId} is out of calibration`;
    }

    case NotificationEvent.StockTransferAssignment: {
      const stockTransfer = await client
        .from("stockTransfer")
        .select("*")
        .eq("id", documentId)
        .single();

      if (stockTransfer.error) {
        console.error("Failed to get stockTransfer", stockTransfer.error);
        throw stockTransfer.error;
      }

      return `Stock Transfer ${stockTransfer?.data?.stockTransferId} assigned to you`;
    }

    case NotificationEvent.PickingListAssignment: {
      const pickingList = await client
        .from("pickingList")
        .select("*")
        .eq("id", documentId)
        .single();

      if (pickingList.error) {
        console.error("Failed to get pickingList", pickingList.error);
        throw pickingList.error;
      }

      return `Picking List ${pickingList?.data?.pickingListId} assigned to you`;
    }

    case NotificationEvent.TrainingAssignment: {
      const trainingAssignment = await client
        .from("trainingAssignment")
        .select("*, training(id, name)")
        .eq("id", documentId)
        .single();

      if (trainingAssignment.error) {
        console.error(
          "Failed to get trainingAssignment",
          trainingAssignment.error
        );
        throw trainingAssignment.error;
      }

      return `Training "${trainingAssignment?.data?.training?.name}" assigned to you`;
    }

    case NotificationEvent.ResourceTrainingAssignment: {
      const training = await client
        .from("training")
        .select("name")
        .eq("id", documentId)
        .single();

      if (training.error) {
        console.error("Failed to get training", training.error);
        throw training.error;
      }

      return `Training "${training?.data?.name}" assigned to you`;
    }

    case NotificationEvent.PurchaseOrderAssignment: {
      const purchaseOrder = await client
        .from("purchaseOrder")
        .select("*")
        .eq("id", documentId)
        .single();

      if (purchaseOrder.error) {
        console.error("Failed to get purchaseOrder", purchaseOrder.error);
        throw purchaseOrder.error;
      }

      return `Purchase Order ${purchaseOrder?.data?.purchaseOrderId} assigned to you`;
    }

    case NotificationEvent.PurchaseInvoiceAssignment: {
      const purchaseInvoice = await client
        .from("purchaseInvoice")
        .select("*")
        .eq("id", documentId)
        .single();

      if (purchaseInvoice.error) {
        console.error("Failed to get purchaseInvoice", purchaseInvoice.error);
        throw purchaseInvoice.error;
      }

      return `Purchase Invoice ${purchaseInvoice?.data?.invoiceId} assigned to you`;
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
      return `New suggestion submitted by ${submittedBy}`;
    }

    case NotificationEvent.RiskAssignment: {
      const risk = await client
        .from("riskRegister")
        .select("*")
        .eq("id", documentId)
        .single();

      if (risk.error) {
        console.error("Failed to get risk", risk.error);
        throw risk.error;
      }

      return `Risk "${risk?.data?.title}" assigned to you`;
    }

    case NotificationEvent.SupplierQuoteAssignment: {
      const supplierQuoteAssignment = await client
        .from("supplierQuote")
        .select("*")
        .eq("id", documentId)
        .single();

      if (supplierQuoteAssignment.error) {
        console.error(
          "Failed to get supplier quote",
          supplierQuoteAssignment.error
        );
        throw supplierQuoteAssignment.error;
      }

      return `Supplier Quote ${supplierQuoteAssignment?.data?.supplierQuoteId} assigned to you`;
    }

    case NotificationEvent.SupplierQuoteResponse: {
      const supplierQuote = await client
        .from("supplierQuote")
        .select("*")
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
      return `Supplier Quote ${supplierQuote?.data?.supplierQuoteId} was submitted by ${respondedBy}`;
    }

    case NotificationEvent.ApprovalRequested: {
      if (documentType === "purchaseOrder") {
        const purchaseOrderResult = await client
          .from("purchaseOrder")
          .select("purchaseOrderId")
          .eq("id", documentId)
          .single();

        if (purchaseOrderResult.error || !purchaseOrderResult.data) {
          console.error(
            "Failed to retrieve purchase order for approval notification",
            purchaseOrderResult.error
          );
          return "Purchase order requires your approval";
        }

        return `Purchase order ${purchaseOrderResult.data.purchaseOrderId} requires your approval`;
      }

      if (documentType === "qualityDocument") {
        const qualityDocumentResult = await client
          .from("qualityDocument")
          .select("name")
          .eq("id", documentId)
          .single();

        if (qualityDocumentResult.error || !qualityDocumentResult.data) {
          console.error(
            "Failed to retrieve quality document for approval notification",
            qualityDocumentResult.error
          );
          return "Quality document requires your approval";
        }

        const qualityDocumentName =
          qualityDocumentResult.data.name ?? "Untitled";
        return `Quality document "${qualityDocumentName}" requires your approval`;
      }
      return `Approval requested`;
    }

    case NotificationEvent.ApprovalApproved: {
      if (documentType === "purchaseOrder") {
        const poApproved = await client
          .from("purchaseOrder")
          .select("purchaseOrderId")
          .eq("id", documentId)
          .single();
        if (poApproved.error || !poApproved.data) {
          return "Your purchase order was approved";
        }
        return `Purchase order ${poApproved.data.purchaseOrderId} was approved`;
      }
      if (documentType === "qualityDocument") {
        const qdApproved = await client
          .from("qualityDocument")
          .select("name")
          .eq("id", documentId)
          .single();
        if (qdApproved.error || !qdApproved.data) {
          return "Your quality document was approved";
        }
        return `Quality document "${qdApproved.data.name ?? "Untitled"}" was approved`;
      }
      return "Your approval request was approved";
    }

    case NotificationEvent.ApprovalRejected: {
      if (documentType === "purchaseOrder") {
        const poRejected = await client
          .from("purchaseOrder")
          .select("purchaseOrderId")
          .eq("id", documentId)
          .single();
        if (poRejected.error || !poRejected.data) {
          return "Your purchase order was rejected";
        }
        return `Purchase order ${poRejected.data.purchaseOrderId} was rejected`;
      }
      if (documentType === "qualityDocument") {
        const qdRejected = await client
          .from("qualityDocument")
          .select("name")
          .eq("id", documentId)
          .single();
        if (qdRejected.error || !qdRejected.data) {
          return "Your quality document was rejected";
        }
        return `Quality document "${qdRejected.data.name ?? "Untitled"}" was rejected`;
      }
      return "Your approval request was rejected";
    }

    default:
      return null;
  }
}

// Per-event default destinations. Callers can override by passing
// `destinations` in the payload; otherwise these defaults apply.
// InApp is always added separately and cannot be opted out of.
const defaultDestinations: Partial<
  Record<NotificationEvent, NotificationDestination[]>
> = {
  [NotificationEvent.ApprovalApproved]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.ApprovalRejected]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.ApprovalRequested]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.DigitalQuoteResponse]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.GaugeCalibrationExpired]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.JobAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.JobCompleted]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.JobOperationAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.JobOperationMessage]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.MaintenanceDispatchAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.MaintenanceDispatchCreated]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.NonConformanceAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.ProcedureAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.PurchaseInvoiceAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.PurchaseOrderAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.QuoteAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.QuoteExpired]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.RiskAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.SalesOrderAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.SalesRfqAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.SalesRfqReady]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.StockTransferAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.PickingListAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.SuggestionResponse]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.SupplierQuoteAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.SupplierQuoteResponse]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.TrainingAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.ResourceTrainingAssignment]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ]
};

export const notifyFunction = inngest.createFunction(
  {
    id: "notify",
    retries: 3
  },
  { event: "carbon/notify" },
  async ({ event, step }) => {
    const payload = event.data as Events["carbon/notify"]["data"];
    // inApp is always on so the topbar reflects every notification. Callers
    // can request additional channels (email, slack) but cannot opt out of
    // the in-app row.
    const destinations: NotificationDestination[] = Array.from(
      new Set<NotificationDestination>([
        NotificationDestination.InApp,
        ...(payload.destinations ?? defaultDestinations[payload.event] ?? [])
      ])
    );

    const client = getCarbonServiceRole();

    const description = await step.run("get-description", async () => {
      return getDescription(
        client,
        payload.event,
        payload.documentId,
        payload.documentType
      );
    });

    if (!description) {
      throw new Error(
        `No description found for notification type ${payload.event} with documentId ${payload.documentId}`
      );
    }

    // Resolve recipient userIds and dedupe (group lookups can yield repeats).
    const userIds = await step.run("resolve-recipients", async () => {
      let ids: string[];
      if (payload.recipient.type === "user") {
        ids = [payload.recipient.userId];
      } else if (payload.recipient.type === "users") {
        ids = payload.recipient.userIds;
      } else {
        const result = await client.rpc("users_for_groups", {
          groups: payload.recipient.groupIds
        });
        if (result.error) {
          console.error("Failed to get userIds for groups", result.error);
          throw result.error;
        }
        ids = (result.data ?? []) as string[];
      }
      // Don't notify the sender about their own action.
      if (payload.from) ids = ids.filter((id) => id !== payload.from);
      return [...new Set(ids)];
    });

    if (userIds.length === 0) {
      return;
    }

    // Existing EE hook for non-conformance assignment — keep as a separate
    // path because it handles cross-system task linking (Linear/Jira), not
    // user-facing notification delivery.
    if (
      payload.event === NotificationEvent.NonConformanceAssignment &&
      payload.recipient.type === "user"
    ) {
      await step.run("send-integration-notification", async () => {
        try {
          const integrationsResult = await getCompanyIntegrations(
            client,
            payload.companyId
          );

          if (integrationsResult.data && integrationsResult.data.length > 0) {
            await notifyTaskAssigned(
              { client },
              integrationsResult.data as CompanyIntegration[],
              {
                carbonUrl: `${ERP_URL}/x/issue/${payload.documentId}`,
                companyId: payload.companyId,
                task: {
                  assignee:
                    payload.recipient.type === "user"
                      ? payload.recipient.userId
                      : "",
                  id: payload.documentId,
                  table: "nonConformance",
                  title: description
                },
                userId: payload.from || "system"
              }
            );
          }
        } catch (error) {
          console.error(
            "Failed to send integration assignment notification:",
            error
          );
        }
      });
    }

    const topic = getNotificationTopic(payload.event);

    // ---- In-app fan-out ----
    if (destinations.includes(NotificationDestination.InApp)) {
      await step.run("write-in-app-notifications", async () => {
        const rows = userIds.map((userId) => ({
          companyId: payload.companyId,
          documentType: payload.documentType ?? null,
          event: payload.event,
          from: payload.from ?? null,
          payload: {
            description,
            event: payload.event,
            from: payload.from,
            documentId: payload.documentId,
            ...(payload.documentType && { documentType: payload.documentType })
          },
          documentId: payload.documentId,
          title: description,
          topic,
          userId
        }));

        const { data, error } = await client
          .from("notification")
          .insert(rows)
          .select("id");
        if (error) {
          console.error("Failed to insert notification rows", error);
          throw error;
        }
        return { inserted: data?.length ?? 0, userIds };
      });
    }

    // ---- Email fan-out ----
    if (destinations.includes(NotificationDestination.Email)) {
      const emailAllowed = await step.run("check-email-plan", () =>
        companyHasPlan(client, payload.companyId, {
          feature: "EMAIL_NOTIFICATIONS"
        })
      );
      if (!emailAllowed) {
        console.warn("Email not allowed");
        return;
      }
      const emailEvents = await step.run(
        "resolve-email-recipients",
        async () => {
          const { data: users, error } = await client
            .from("user")
            .select("id, email, fullName")
            .in("id", userIds);
          if (error) {
            console.error("Failed to resolve email recipients", error);
            throw error;
          }

          const subject = description;
          const heading = getNotificationEmailHeading(payload.event);
          const ctaLabel = getNotificationEmailCtaLabel(payload.event);
          const ctaUrl = buildNotificationLink(
            payload.event,
            payload.documentId,
            payload.companyId,
            payload.documentType
          );

          const recipients = (users ?? []).filter((u) => u.email);

          // Render the template once per recipient because the greeting bakes
          // in the user's name. The template itself is small so this is cheap;
          // if it ever becomes hot we can split into a shared body + per-user
          // greeting Section.
          const events = await Promise.all(
            recipients.map(async (u) => {
              const html = await render(
                NotificationEmail({
                  ctaLabel,
                  ctaUrl,
                  heading,
                  message: description,
                  preview: heading,
                  recipientName: u.fullName ?? undefined
                })
              );
              return {
                data: {
                  companyId: payload.companyId,
                  html,
                  subject,
                  text: `${description}\n\n${ctaLabel}: ${ctaUrl}`,
                  to: u.email
                },
                name: "carbon/send-email" as const
              };
            })
          );
          return events;
        }
      );
      if (emailEvents.length > 0) {
        await step.sendEvent("fan-out-emails", emailEvents);
      }
    }

    // ---- Slack DM fan-out ----
    // Per-user DMs via the company's linked Slack workspace. Users without a
    // matching Slack account in that workspace are silently skipped.
    if (destinations.includes(NotificationDestination.Slack)) {
      const slackEvents = await step.run(
        "resolve-slack-recipients",
        async () => {
          const { data: integration, error } = await client
            .from("companyIntegration")
            .select("active, metadata")
            .eq("companyId", payload.companyId)
            .eq("id", "slack")
            .maybeSingle();

          if (error) {
            console.error("Failed to resolve Slack integration", error);
            return [];
          }
          if (!integration?.active) return [];

          const metadata = integration.metadata as {
            access_token?: string;
          } | null;
          const accessToken = metadata?.access_token;
          if (!accessToken) return [];

          const ctaUrl = buildNotificationLink(
            payload.event,
            payload.documentId,
            payload.companyId,
            payload.documentType
          );
          const text = `${description}\n<${ctaUrl}|View in Carbon>`;

          const slackUserIds = await Promise.all(
            userIds.map((userId) =>
              getSlackUserIdByCarbonId(client, accessToken, userId)
            )
          );

          return slackUserIds
            .filter((id): id is string => !!id)
            .map((slackUserId) => ({
              data: {
                channel: slackUserId,
                companyId: payload.companyId,
                text
              },
              name: "carbon/send-slack" as const
            }));
        }
      );

      if (slackEvents.length > 0) {
        await step.sendEvent("fan-out-slack", slackEvents);
      }
    }
  }
);
