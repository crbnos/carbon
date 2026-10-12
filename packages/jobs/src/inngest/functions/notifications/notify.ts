// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { fetchAllByIds } from "@carbon/database";
import { resolveIntegrationSecrets } from "@carbon/ee";
import { emailNotificationsEnabled } from "@carbon/ee/email-notifications.server";
import {
  type CompanyIntegration,
  notifyTaskAssigned
} from "@carbon/ee/notifications";
import { getSlackUserIdByCarbonId } from "@carbon/ee/slack.server";
import {
  CONTROLLED_ENVIRONMENT,
  ERP_URL,
  SESSION_ABSOLUTE_MAX_MS,
  SESSION_MAX_AGE
} from "@carbon/env";
import { isPushConfigured } from "@carbon/env/push.server";
import type { Events } from "@carbon/lib/events";
import {
  escapeSlackText,
  getNotificationEmailCtaLabel,
  getNotificationEmailHeading,
  getNotificationTopic,
  isRecurringNotificationEvent,
  NotificationDestination,
  NotificationEvent,
  renderInlineLinks,
  renderSlackMrkdwn
} from "@carbon/notifications";
import { chunkArray, datetime } from "@carbon/utils";
import { now } from "@internationalized/date";
import { render } from "@react-email/components";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";
import {
  buildNotificationLink,
  getNotificationContent,
  getNotificationEmailComponent
} from "./content";
import { pushSessionMaxAgeMs, pushSubscriptionCutoff } from "./push-outcome";

// A group notification can have hundreds of recipients. One request, insert
// or send that carries all of them fails the whole notification, so each is
// split into chunks of these sizes.

// Ids per `.in()` write: the filter rides in the URL, and the gateway rejects
// a request line it cannot buffer (HTTP 431). Reads use fetchAllByIds.
const IN_FILTER_CHUNK = 100;

// Rows per `notification` insert, so one request body stays small.
const INSERT_CHUNK = 500;

// Emails per render step and per send. One rendered notification email is
// about 16.9 KB, and Inngest accepts at most 512 KB in one send: 20 × 16.9 KB
// is about 338 KB, far under a step's 4 MB output limit too.
const EMAIL_CHUNK = 20;

// Slack and push events per send. Each event is under 1 KB.
const EVENT_CHUNK = 500;

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
// InApp is always added separately and cannot be opted out of. Push is not
// listed here: it follows in-app, so every notification pushes.
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
  [NotificationEvent.ChangeNoticeStarted]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.ChangeNoticeImplementation]: [
    NotificationDestination.Email,
    NotificationDestination.Slack
  ],
  [NotificationEvent.ChangeNoticeDone]: [
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
  // Deliberately email-only (no Slack): a compliance heads-up for the sales
  // group, not an actionable assignment.
  [NotificationEvent.SalesRuleViolation]: [NotificationDestination.Email],
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
  [NotificationEvent.PurchasingRfqAssignment]: [
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
  ],
  [NotificationEvent.Workflow]: [
    NotificationDestination.InApp,
    NotificationDestination.Email
  ],
  // At most one per recipient per daily run.
  [NotificationEvent.RecurringInvoicing]: [
    NotificationDestination.InApp,
    NotificationDestination.Email
  ],
  // In-app only: the outbound sweep re-fires while failures persist, and an
  // email per sweep cycle would be noise. Browser push still follows in-app,
  // so the integration's last editor gets a push every sweep (30 min) until
  // the failures clear — deliberate: push mirrors the bell exactly.
  [NotificationEvent.IntegrationSync]: [NotificationDestination.InApp]
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
    // with the first entry as the fallback link target. Workflow notifications
    // always supply one too — the run id when the customer named no record.
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
        {
          body: payload.body,
          companyId: payload.companyId,
          documentIds: payload.documentIds,
          documentType: payload.documentType,
          title: payload.title,
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
      ids = [...new Set(ids)];

      // Every read keyed by the recipients goes through fetchAllByIds: a
      // group can hold more users than one `.in()` URL or one 1000-row page
      // carries, and a read cut short would drop recipients without an error.
      if (ids.length > 0) {
        const members = await fetchAllByIds(ids, (batch) =>
          client
            .from("userToCompany")
            .select("userId")
            .eq("companyId", payload.companyId)
            .in("userId", batch)
            .order("userId")
        );
        if (members.error) {
          console.error(
            "Failed to filter recipients by company membership",
            members.error
          );
          throw members.error;
        }
        const memberIds = new Set(members.data.map((m) => m.userId));
        ids = ids.filter((id) => memberIds.has(id));
      }
      return ids;
    });

    if (userIds.length === 0) {
      return;
    }

    const topic = getNotificationTopic(payload.event);

    const wantsEmail = destinations.includes(NotificationDestination.Email);
    const wantsSlack = destinations.includes(NotificationDestination.Slack);
    // Push mirrors in-app: every notification goes to every browser with
    // notifications enabled, with no per-topic switch. The push keys come from
    // SESSION_SECRET, so only a deployment without one has no push channel.
    const wantsPush = isPushConfigured();

    // Per-user channel opt-outs: absence of a row = enabled; enabled=false
    // mutes that (topic, channel). In-app delivery is never filtered.
    const { emailRecipientIds, slackRecipientIds } =
      wantsEmail || wantsSlack
        ? await step.run("filter-recipients-by-preference", async () => {
            const { data: prefs, error } = await fetchAllByIds(
              userIds,
              (batch) =>
                client
                  .from("notificationPreference")
                  .select("userId, channel, enabled")
                  .in("userId", batch)
                  .eq("companyId", payload.companyId)
                  .eq("topic", topic)
                  .order("userId")
                  .order("channel")
            );
            if (error) {
              console.error("Failed to load notification preferences", error);
              throw error;
            }
            const mutedFor = (channel: "email" | "slack") =>
              new Set(
                (prefs ?? [])
                  .filter((p) => p.channel === channel && !p.enabled)
                  .map((p) => p.userId)
              );
            const emailMuted = mutedFor("email");
            const slackMuted = mutedFor("slack");
            return {
              emailRecipientIds: userIds.filter((id) => !emailMuted.has(id)),
              slackRecipientIds: userIds.filter((id) => !slackMuted.has(id))
            };
          })
        : { emailRecipientIds: userIds, slackRecipientIds: userIds };

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
          const supersededAt = datetime.timestamp();

          // One chunk of recipients at a time: the ids ride in the URL.
          for (const chunk of chunkArray(userIds, IN_FILTER_CHUNK)) {
            const [supersededDigests, supersededFlat] = await Promise.all([
              client
                .from("notification")
                .update({ readAt: supersededAt, seenAt: supersededAt })
                .eq("companyId", payload.companyId)
                .eq("event", NotificationEvent.Digest)
                .eq("payload->>sourceEvent", payload.event)
                .is("readAt", null)
                .in("userId", chunk),
              client
                .from("notification")
                .update({ readAt: supersededAt, seenAt: supersededAt })
                .eq("companyId", payload.companyId)
                .eq("event", payload.event)
                .is("digestedInto", null)
                .is("readAt", null)
                .in("userId", chunk)
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
        }

        // Multi-item digest: one expandable Digest parent per recipient plus a
        // hidden clickable child row per document — the shape the existing
        // DigestNotification UI renders. Single-item digests use the flat path.
        if (digestItems && digestItems.length > 1) {
          let inserted = 0;
          // One parent insert per chunk of recipients, then their children,
          // instead of two round trips per recipient.
          for (const chunk of chunkArray(userIds, IN_FILTER_CHUNK)) {
            const parents = await client
              .from("notification")
              .insert(
                chunk.map((userId) => ({
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
                }))
              )
              .select("id, userId");
            if (parents.error) {
              console.error("Failed to insert digest parents", parents.error);
              throw parents.error;
            }
            inserted += parents.data.length;

            // Keyed by user, so the order the rows come back in never matters.
            const parentIdByUser = new Map(
              parents.data.map((parent) => [parent.userId, parent.id])
            );
            const childRows = chunk.flatMap((userId) => {
              const parentId = parentIdByUser.get(userId);
              if (!parentId) {
                const error = new Error(
                  `Failed to insert digest parent for ${userId}`
                );
                console.error("Failed to insert digest parent", {
                  companyId: payload.companyId,
                  userId
                });
                throw error;
              }
              return digestItems.map((item) => ({
                companyId: payload.companyId,
                digestedInto: parentId,
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
            });

            for (const rows of chunkArray(childRows, INSERT_CHUNK)) {
              const children = await client
                .from("notification")
                .insert(rows)
                .select("id");
              if (children.error) {
                console.error(
                  "Failed to insert digest children",
                  children.error
                );
                throw children.error;
              }
              inserted += children.data?.length ?? 0;
            }
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

        let inserted = 0;
        for (const chunk of chunkArray(rows, INSERT_CHUNK)) {
          const { data, error } = await client
            .from("notification")
            .insert(chunk)
            .select("id");
          if (error) {
            console.error("Failed to insert notification rows", error);
            throw error;
          }
          inserted += data?.length ?? 0;
        }
        return { inserted, userIds };
      });
    }

    // ---- Email fan-out ----
    // The plan check gates only the email channel — Slack fan-out below must
    // still run for companies without EMAIL_NOTIFICATIONS.
    const emailAllowed =
      wantsEmail &&
      (await step.run("check-email-plan", () =>
        emailNotificationsEnabled(client, payload.companyId)
      ));

    if (wantsEmail && !emailAllowed) {
      console.warn(
        `EMAIL_NOTIFICATIONS not enabled for company ${payload.companyId}; skipping email fan-out`
      );
    }

    if (emailAllowed && emailRecipientIds.length > 0) {
      // The read is its own step, and each chunk of EMAIL_CHUNK recipients is
      // rendered and sent in steps of its own: one step holding every
      // recipient's HTML outgrows a step's output and a send's size limit.
      // These step ids are new on purpose: the single step they replace
      // stored its output in another shape, and a replay must not read it.
      const recipients = await step.run("load-email-recipients", async () => {
        const { data: users, error } = await fetchAllByIds(
          emailRecipientIds,
          (batch) =>
            client
              .from("user")
              .select("id, email, fullName")
              .in("id", batch)
              .order("id")
        );
        if (error) {
          console.error("Failed to resolve email recipients", error);
          throw error;
        }
        return (users ?? []).filter((u) => u.email);
      });

      const subject = description;
      const heading = getNotificationEmailHeading(payload.event);
      const ctaLabel = getNotificationEmailCtaLabel(payload.event);
      const ctaUrl = buildNotificationLink(
        payload.event,
        primaryDocumentId,
        payload.companyId,
        payload.documentType
      );

      // Recurring reminders carry delivery tracking; the recurrence
      // period is folded into the tracked id ("ta_1:2026") so each period
      // gets a fresh MAX_NOTIFICATION_DELIVERIES budget, while a plain id
      // (no period) caps permanently.
      const trackedDocumentIds = isRecurringNotificationEvent(payload.event)
        ? (digestItems?.map((item) =>
            item.period ? `${item.documentId}:${item.period}` : item.documentId
          ) ?? [primaryDocumentId])
        : null;

      for (const [index, chunk] of chunkArray(
        recipients,
        EMAIL_CHUNK
      ).entries()) {
        // Render the template once per recipient because the greeting bakes
        // in the user's name. The template itself is small so this is cheap;
        // if it ever becomes hot we can split into a shared body + per-user
        // greeting Section.
        const emailEvents = await step.run(`render-emails-${index}`, () =>
          Promise.all(
            chunk.map(async (u) => {
              const html = await render(
                getNotificationEmailComponent({
                  companyId: payload.companyId,
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
          )
        );
        await step.sendEvent(`fan-out-emails-${index}`, emailEvents);
      }
    }

    // ---- Slack DM fan-out ----
    // Per-user DMs via the company's linked Slack workspace. Users without a
    // matching Slack account in that workspace are silently skipped.
    if (wantsSlack && slackRecipientIds.length > 0) {
      const slackEvents = await step.run(
        "resolve-slack-recipients",
        async () => {
          const { data: integration, error } = await client
            .from("companyIntegration")
            .select("active, metadata, secretRef")
            .eq("companyId", payload.companyId)
            .eq("id", "slack")
            .maybeSingle();

          if (error) {
            console.error("Failed to resolve Slack integration", error);
            return [];
          }
          if (!integration?.active) return [];

          // Secret material (access_token) lives in Supabase Vault; merge it
          // back so we read the same shape as before. `client` is service-role.
          const metadata = (await resolveIntegrationSecrets(
            client,
            payload.companyId,
            "slack",
            integration.metadata,
            integration.secretRef
          )) as { access_token?: string } | null;
          const accessToken = metadata?.access_token;
          if (!accessToken) return [];

          const ctaUrl = buildNotificationLink(
            payload.event,
            primaryDocumentId,
            payload.companyId,
            payload.documentType
          );
          const slackDetailLines = details
            .map(
              (detail) =>
                `${escapeSlackText(detail.label)}: ${renderSlackMrkdwn(detail.value, ERP_URL)}`
            )
            .join("\n");
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
                slackDetailLines ? `\n${slackDetailLines}` : ""
              }\n<${ctaUrl}|View in Carbon>`;

          const slackUserIds = await Promise.all(
            slackRecipientIds.map((userId) =>
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

      for (const [index, chunk] of chunkArray(
        slackEvents,
        EVENT_CHUNK
      ).entries()) {
        await step.sendEvent(`fan-out-slack-${index}`, chunk);
      }
    }

    // ---- Push fan-out ----
    // Every recipient of the in-app row, one carbon/send-push per browser row,
    // so each browser retries on its own. A row belongs to the user, not a
    // company: recipients are already limited to members of this
    // notification's company (resolve-recipients), so each user gets the push
    // of every company they belong to.
    if (wantsPush) {
      const pushEvents = await step.run(
        "resolve-push-subscriptions",
        async () => {
          // Skip browsers no session has saved within a session's lifetime:
          // their session ended without a sign-out.
          const liveSince = pushSubscriptionCutoff(
            now("UTC"),
            pushSessionMaxAgeMs({
              controlledEnvironment: CONTROLLED_ENVIRONMENT,
              absoluteMaxMs: SESSION_ABSOLUTE_MAX_MS,
              cookieMaxAgeSeconds: SESSION_MAX_AGE
            })
          );
          const { data: subscriptions, error } = await fetchAllByIds(
            userIds,
            (batch) =>
              client
                .from("pushSubscription")
                .select("id, userId")
                .in("userId", batch)
                .gte("updatedAt", liveSince)
                .order("id")
          );
          if (error) {
            console.error("Failed to load push subscriptions", error);
            throw error;
          }
          const url = buildNotificationLink(
            payload.event,
            primaryDocumentId,
            payload.companyId,
            payload.documentType
          );
          // A workflow notification carries its author's subject as the
          // description and their message as the "Message" detail; the
          // generic heading would title every one "Workflow". A system
          // notification shows no links, so [label](url) keeps its label.
          const isWorkflow = payload.event === NotificationEvent.Workflow;
          const title = isWorkflow
            ? description
            : getNotificationEmailHeading(payload.event);
          const body = isWorkflow
            ? renderInlineLinks(details[0]?.value ?? "", ERP_URL)
                .map((segment) => segment.text)
                .join("")
            : description;
          return (subscriptions ?? []).map((subscription) => ({
            data: {
              body,
              companyId: payload.companyId,
              subscriptionId: subscription.id,
              userId: subscription.userId,
              tag: `${payload.event}:${primaryDocumentId}`,
              title,
              url
            },
            name: "carbon/send-push" as const
          }));
        }
      );
      for (const [index, chunk] of chunkArray(
        pushEvents,
        EVENT_CHUNK
      ).entries()) {
        await step.sendEvent(`fan-out-push-${index}`, chunk);
      }
    }
  }
);
