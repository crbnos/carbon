import { getCarbonServiceRole } from "@carbon/auth/client.server";
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
  isRecurringNotificationEvent,
  NotificationDestination,
  NotificationEvent
} from "@carbon/notifications";
import { render } from "@react-email/components";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";
import {
  buildNotificationLink,
  getNotificationContent,
  getNotificationEmailComponent
} from "./content";

// Slack mrkdwn requires &, <, > escaped in text; inside a <url|label> a
// literal "|" would also terminate the label, so it's swapped for a lookalike.
function escapeSlackText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "¦");
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
  // Digest-shaped: email is one WeeklyReminderEmail per employee, not one
  // email per training (see getNotificationEmailComponent).
  [NotificationEvent.TrainingReminder]: [
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

    // Single-document events pass documentId; digest events pass documentIds
    // with the first entry as the fallback link target.
    const primaryDocumentId = payload.documentId ?? payload.documentIds?.[0];
    if (!primaryDocumentId) {
      throw new NonRetriableError(
        `carbon/notify event ${payload.event} has neither documentId nor documentIds`
      );
    }

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

    // Step id intentionally differs from the old "get-description": the result
    // shape changed, so in-flight runs must re-execute this idempotent read
    // rather than resume a stale memoized string. Don't rename back.
    const content = await step.run("get-content", async () => {
      return getNotificationContent(
        client,
        payload.event,
        primaryDocumentId,
        payload.from,
        payload.documentType,
        {
          companyId: payload.companyId,
          documentIds: payload.documentIds,
          userId:
            payload.recipient.type === "user"
              ? payload.recipient.userId
              : undefined
        }
      );
    });

    if (!content) {
      // Digest events can legitimately resolve to nothing (all documents
      // completed/deleted in flight) — skip, don't fail.
      if (payload.documentIds?.length) {
        console.warn(
          `carbon/notify ${payload.event}: no outstanding documents remain for documentIds — skipping`
        );
        return;
      }
      throw new NonRetriableError(
        `No description found for notification type ${payload.event} with documentId ${primaryDocumentId}`
      );
    }

    const { description, details } = content;
    const digestItems = content.digest?.items;

    // documentIds on a non-digest event: the extra documents were dropped.
    if ((payload.documentIds?.length ?? 0) > 1 && !content.digest) {
      console.warn(
        `carbon/notify ${payload.event}: documentIds provided but this event is not digest-capable; only ${primaryDocumentId} was used`
      );
    }
    // "Label: Value" lines for plain-text channels (Slack, email text part);
    // digest content replaces these with one linked line per item instead.
    const detailLines = details
      .map((detail) => `${detail.label}: ${detail.value}`)
      .join("\n");

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
                carbonUrl: `${ERP_URL}/x/issue/${primaryDocumentId}`,
                companyId: payload.companyId,
                task: {
                  assignee:
                    payload.recipient.type === "user"
                      ? payload.recipient.userId
                      : "",
                  id: primaryDocumentId,
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
        // Digest-capable events describe current state, so a new write
        // supersedes every still-unread prior reminder for these recipients —
        // both digest parents (via the payload.sourceEvent marker) and flat
        // single-item rows. Supersede-first also makes step retries
        // self-healing. Mark-read, never delete: digestedInto is
        // ON DELETE SET NULL, so deleting a parent would resurface its hidden
        // children. Cron digests (no sourceEvent) are intentionally untouched.
        if (content.digest) {
          const supersededAt = new Date().toISOString();

          const [supersededDigests, supersededFlat] = await Promise.all([
            client
              .from("notification")
              .update({ readAt: supersededAt, seenAt: supersededAt })
              .eq("companyId", payload.companyId)
              .eq("event", NotificationEvent.Digest)
              .eq("payload->>sourceEvent", payload.event)
              .is("readAt", null)
              .in("userId", userIds),
            client
              .from("notification")
              .update({ readAt: supersededAt, seenAt: supersededAt })
              .eq("companyId", payload.companyId)
              .eq("event", payload.event)
              .is("digestedInto", null)
              .is("readAt", null)
              .in("userId", userIds)
          ]);
          const supersedeError =
            supersededDigests.error ?? supersededFlat.error;
          if (supersedeError) {
            console.error(
              "Failed to supersede prior reminder rows",
              supersedeError
            );
            throw supersedeError;
          }
        }

        // Multi-item digest: one expandable Digest parent per recipient plus a
        // hidden clickable child row per document — the shape the existing
        // DigestNotification UI renders. Single-item digests use the flat path.
        if (digestItems && digestItems.length > 1) {
          let inserted = 0;
          for (const userId of userIds) {
            const parent = await client
              .from("notification")
              .insert({
                companyId: payload.companyId,
                event: NotificationEvent.Digest,
                payload: {
                  count: digestItems.length,
                  description,
                  event: NotificationEvent.Digest,
                  sourceEvent: payload.event,
                  topic
                },
                title: description,
                topic,
                userId
              })
              .select("id")
              .single();
            if (parent.error || !parent.data?.id) {
              console.error("Failed to insert digest parent", parent.error);
              throw parent.error ?? new Error("Failed to insert digest parent");
            }

            const childRows = digestItems.map((item) => ({
              companyId: payload.companyId,
              digestedInto: parent.data.id,
              documentId: item.documentId,
              documentType: payload.documentType ?? null,
              event: payload.event,
              from: payload.from ?? null,
              payload: {
                description: item.description,
                documentId: item.documentId,
                event: payload.event,
                from: payload.from
              },
              title: item.description,
              topic,
              userId
            }));

            const children = await client
              .from("notification")
              .insert(childRows)
              .select("id");
            if (children.error) {
              console.error("Failed to insert digest children", children.error);
              throw children.error;
            }
            inserted += 1 + (children.data?.length ?? 0);
          }
          return { inserted, userIds };
        }

        const rows = userIds.map((userId) => ({
          companyId: payload.companyId,
          documentType: payload.documentType ?? null,
          event: payload.event,
          from: payload.from ?? null,
          payload: {
            description,
            event: payload.event,
            from: payload.from,
            documentId: primaryDocumentId,
            ...(details.length > 0 && { details }),
            ...(payload.documentType && { documentType: payload.documentType })
          },
          documentId: primaryDocumentId,
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
    // The plan check gates only the email channel — Slack fan-out below must
    // still run for companies without EMAIL_NOTIFICATIONS.
    const emailAllowed =
      destinations.includes(NotificationDestination.Email) &&
      (await step.run("check-email-plan", () =>
        companyHasPlan(client, payload.companyId, {
          feature: "EMAIL_NOTIFICATIONS"
        })
      ));

    if (destinations.includes(NotificationDestination.Email) && !emailAllowed) {
      console.warn(
        `EMAIL_NOTIFICATIONS not enabled for company ${payload.companyId}; skipping email fan-out`
      );
    }

    if (emailAllowed) {
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
            primaryDocumentId,
            payload.companyId,
            payload.documentType
          );

          const recipients = (users ?? []).filter((u) => u.email);

          // Recurring reminders carry delivery tracking; the recurrence
          // period is folded into the tracked id ("ta_1:2026") so each period
          // gets a fresh MAX_NOTIFICATION_DELIVERIES budget, while a plain id
          // (no period) caps permanently.
          const trackedDocumentIds = isRecurringNotificationEvent(payload.event)
            ? (digestItems?.map((item) =>
                item.period
                  ? `${item.documentId}:${item.period}`
                  : item.documentId
              ) ?? [primaryDocumentId])
            : null;

          // Render the template once per recipient because the greeting bakes
          // in the user's name. The template itself is small so this is cheap;
          // if it ever becomes hot we can split into a shared body + per-user
          // greeting Section.
          const events = await Promise.all(
            recipients.map(async (u) => {
              const html = await render(
                getNotificationEmailComponent({
                  content,
                  ctaLabel,
                  ctaUrl,
                  event: payload.event,
                  heading,
                  recipientName: u.fullName ?? undefined
                })
              );
              // Digest: one linked line per document (no footer CTA — the
              // items are the actions). Otherwise: detail rows + footer CTA.
              const text = digestItems
                ? [
                    description,
                    "",
                    ...digestItems.map(
                      (item) =>
                        `- ${item.title}${
                          item.status ? ` (${item.status})` : ""
                        }${item.url ? `: ${item.url}` : ""}`
                    )
                  ].join("\n")
                : `${description}${
                    detailLines ? `\n\n${detailLines}` : ""
                  }\n\n${ctaLabel}: ${ctaUrl}`;

              return {
                data: {
                  companyId: payload.companyId,
                  html,
                  subject,
                  text,
                  to: u.email,
                  ...(trackedDocumentIds && {
                    tracking: {
                      documentIds: trackedDocumentIds,
                      event: payload.event,
                      userId: u.id
                    }
                  })
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
            primaryDocumentId,
            payload.companyId,
            payload.documentType
          );
          // Digest: one mrkdwn-linked line per document (items are the
          // actions, no footer link). Otherwise: detail rows + footer link.
          const text = digestItems
            ? [
                description,
                ...digestItems.map((item) => {
                  const title = escapeSlackText(item.title);
                  return `• ${
                    item.url ? `<${item.url}|${title}>` : title
                  }${item.status ? ` — ${item.status}` : ""}`;
                })
              ].join("\n")
            : `${description}${
                detailLines ? `\n${detailLines}` : ""
              }\n<${ctaUrl}|View in Carbon>`;

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
