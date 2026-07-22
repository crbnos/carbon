import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  HubDigestEmail,
  HubNudgeEmail,
  StreakMilestoneEmail
} from "@carbon/documents/email";
import { ERP_URL } from "@carbon/env";
import { getSlackClient } from "@carbon/lib/slack.server";
import {
  ACTIVATION_STREAK_DAYS,
  gateProgress,
  LIVE_FIELD_KEYS,
  milestoneGuardKey,
  NOTIFYING_MILESTONES,
  reduceStreak,
  STREAK_MILESTONES,
  USAGE_DAY_COLLECTION,
  type UsageDayInput
} from "@carbon/onboarding/engine";
import { parseDate } from "@internationalized/date";
import { render } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "../../client";

// The Implementation Hub's always-on layer, in three crons:
//
// 1. implementation-usage (hourly) — the activation engine. For every factory
//    past cutover it scores each business day (real work in ≥2 areas), folds
//    the Duolingo streak (freezes, milestones, activation at ten straight
//    days), and fires the day-3 / day-10 trophies (email CC'ing the Carbon
//    team + internal Slack). Keeps scoring after activation — reliance is
//    measured forever, even though the customer's scoreboard closes.
// 2. implementation-digest (Mondays) — the owner's week: phase progress, the
//    one thing this week, the date on the wall.
// 3. implementation-nudge (daily) — quiet detection: seven quiet days emails
//    the owner naming the actual next step; fourteen pings the Carbon team.
//
// Recipients: the intake-named owner (contacts.ownerEmail), falling back to
// the enrolling user's email. Team targets are env-configurable.

type Client = SupabaseClient<Database>;

const CARBON_TEAM_EMAIL = () =>
  process.env.CARBON_TEAM_EMAIL || "info@carbon.ms";
const CARBON_TEAM_SLACK_CHANNEL = () =>
  process.env.CARBON_TEAM_SLACK_CHANNEL || "#sales";

const hubUrl = (page?: string) =>
  `${ERP_URL}/x/get-started${page ? `/${page}` : ""}`;

interface HubRow {
  id: string;
  status: string;
  contacts: { owner?: string; ownerEmail?: string } | null;
  createdBy: string;
}

type HubStatus = "tailoring" | "shared" | "active" | "complete" | "archived";

async function getHubs(serviceRole: Client, statuses: HubStatus[]) {
  const result = await serviceRole
    .from("implementationHub")
    .select("id, status, contacts, createdBy")
    .in("status", statuses);
  return (result.data ?? []) as unknown as HubRow[];
}

async function ownerRecipient(
  serviceRole: Client,
  hub: HubRow
): Promise<{ name: string; email: string } | null> {
  const contacts = hub.contacts ?? {};
  if (contacts.ownerEmail) {
    return { name: contacts.owner ?? "there", email: contacts.ownerEmail };
  }
  const user = await serviceRole
    .from("user")
    .select("email, fullName")
    .eq("id", hub.createdBy)
    .maybeSingle();
  if (!user.data?.email) return null;
  return {
    name: contacts.owner ?? user.data.fullName ?? "there",
    email: user.data.email
  };
}

async function companyName(serviceRole: Client, companyId: string) {
  const company = await serviceRole
    .from("company")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();
  return company.data?.name ?? "your factory";
}

async function getFieldValue(
  serviceRole: Client,
  companyId: string,
  fieldKey: string
) {
  const result = await serviceRole
    .from("implementationFieldValue")
    .select("value")
    .eq("companyId", companyId)
    .eq("fieldKey", fieldKey)
    .maybeSingle();
  return result.data?.value ?? null;
}

async function setFieldValue(
  serviceRole: Client,
  companyId: string,
  fieldKey: string,
  value: string,
  userId: string
) {
  await serviceRole.from("implementationFieldValue").upsert(
    {
      companyId,
      fieldKey,
      value,
      createdBy: userId,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    },
    { onConflict: "companyId, fieldKey" }
  );
}

async function setCheckState(
  serviceRole: Client,
  companyId: string,
  itemKey: string,
  kind: "gate" | "task" | "check",
  value: string,
  userId: string
) {
  await serviceRole.from("implementationCheckState").upsert(
    {
      companyId,
      itemKey,
      kind,
      value,
      createdBy: userId,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    },
    { onConflict: "companyId, itemKey" }
  );
}

// ---------------------------------------------------------------------------
// 1 · The activation engine
// ---------------------------------------------------------------------------

// Company-local YYYY-MM-DD for "now minus offsetDays" in the given timezone.
function localDate(timezone: string, offsetDays: number): string {
  const now = new Date(Date.now() - offsetDays * 86_400_000);
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return formatter.format(now); // en-CA formats as YYYY-MM-DD
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

// UTC window [start, end) covering the local calendar day.
function dayWindow(date: string, timezone: string): { start: string; end: string } {
  try {
    const start = parseDate(date).toDate(timezone);
    return {
      start: start.toISOString(),
      end: new Date(start.getTime() + 86_400_000).toISOString()
    };
  } catch {
    return {
      start: `${date}T00:00:00Z`,
      end: new Date(
        new Date(`${date}T00:00:00Z`).getTime() + 86_400_000
      ).toISOString()
    };
  }
}

// Score one local business day: real work in at least two areas counts.
async function scoreDay(
  serviceRole: Client,
  companyId: string,
  date: string,
  timezone: string
): Promise<{ signals: Record<string, number>; qualifying: boolean }> {
  const { start, end } = dayWindow(date, timezone);

  const inWindow = (
    table: "salesOrder" | "quote" | "purchaseOrder" | "job" | "productionEvent",
    column: string
  ) =>
    serviceRole
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .gte(column, start)
      .lt(column, end);

  const onDate = (table: "receipt" | "shipment" | "salesInvoice") =>
    serviceRole
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .eq("postingDate", date);

  const [orders, quotes, purchasing, jobs, floor, receiving, shipping, invoicing] =
    await Promise.all([
      inWindow("salesOrder", "createdAt"),
      inWindow("quote", "createdAt"),
      inWindow("purchaseOrder", "createdAt"),
      inWindow("job", "createdAt"),
      inWindow("productionEvent", "startTime"),
      onDate("receipt"),
      onDate("shipment"),
      onDate("salesInvoice")
    ]);

  const signals: Record<string, number> = {
    orders: (orders.count ?? 0) + (quotes.count ?? 0),
    jobs: jobs.count ?? 0,
    purchasing: purchasing.count ?? 0,
    receiving: receiving.count ?? 0,
    floor: floor.count ?? 0,
    shipping: shipping.count ?? 0,
    invoicing: invoicing.count ?? 0
  };
  const activeAreas = Object.values(signals).filter((n) => n > 0).length;
  return { signals, qualifying: activeAreas >= 2 };
}

export const implementationUsageFunction = inngest.createFunction(
  { id: "implementation-usage", retries: 2 },
  { cron: "7 * * * *" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();

    await step.run("score-live-factories", async () => {
      // Everyone past cutover — including activated factories; reliance is
      // tracked internally forever.
      const liveMarks = await serviceRole
        .from("implementationFieldValue")
        .select("companyId, value")
        .eq("fieldKey", LIVE_FIELD_KEYS.liveAt);

      for (const mark of liveMarks.data ?? []) {
        const companyId = mark.companyId;
        try {
          const hub = await serviceRole
            .from("implementationHub")
            .select("id, status, contacts, createdBy")
            .eq("id", companyId)
            .maybeSingle();
          if (!hub.data || hub.data.status === "archived") continue;
          const hubRow = hub.data as unknown as HubRow;
          const systemUser = hubRow.createdBy;

          const location = await serviceRole
            .from("location")
            .select("timezone")
            .eq("companyId", companyId)
            .limit(1)
            .maybeSingle();
          const timezone = location.data?.timezone || "UTC";

          // Existing usage rows (payload: { date, signals, qualifying }).
          const usageRows = await serviceRole
            .from("implementationRow")
            .select("id, payload")
            .eq("companyId", companyId)
            .eq("collection", USAGE_DAY_COLLECTION);
          const byDate = new Map<string, { id: string; qualifying: boolean }>();
          for (const row of usageRows.data ?? []) {
            const payload = row.payload as { date?: string; qualifying?: boolean };
            if (typeof payload.date === "string") {
              byDate.set(payload.date, {
                id: row.id,
                qualifying: payload.qualifying === true
              });
            }
          }

          // Re-score yesterday and today (late-arriving data heals; a counted
          // day is never un-counted).
          for (const offset of [1, 0]) {
            const date = localDate(timezone, offset);
            if (date < mark.value) continue; // before cutover
            if (isWeekend(date)) continue;
            const holiday = await serviceRole
              .from("holiday")
              .select("id")
              .eq("companyId", companyId)
              .eq("date", date)
              .maybeSingle();
            if (holiday.data) continue;

            const scored = await scoreDay(serviceRole, companyId, date, timezone);
            const existing = byDate.get(date);
            const qualifying = (existing?.qualifying ?? false) || scored.qualifying;
            const payload = { date, signals: scored.signals, qualifying };

            if (existing) {
              await serviceRole
                .from("implementationRow")
                .update({
                  payload,
                  updatedBy: systemUser,
                  updatedAt: new Date().toISOString()
                })
                .eq("id", existing.id)
                .eq("companyId", companyId);
            } else {
              await serviceRole.from("implementationRow").insert({
                companyId,
                collection: USAGE_DAY_COLLECTION,
                payload,
                createdBy: systemUser
              });
              byDate.set(date, { id: "new", qualifying });
            }
          }

          // Fold the streak from scratch and persist the derived state.
          const refreshed = await serviceRole
            .from("implementationRow")
            .select("payload")
            .eq("companyId", companyId)
            .eq("collection", USAGE_DAY_COLLECTION);
          const days: UsageDayInput[] = (refreshed.data ?? []).flatMap((row) => {
            const payload = row.payload as { date?: string; qualifying?: boolean };
            return typeof payload.date === "string"
              ? [{ date: payload.date, qualifying: payload.qualifying === true }]
              : [];
          });
          const streak = reduceStreak(days);

          await setFieldValue(serviceRole, companyId, LIVE_FIELD_KEYS.streak, String(streak.streak), systemUser);
          await setFieldValue(serviceRole, companyId, LIVE_FIELD_KEYS.streakBest, String(streak.best), systemUser);
          await setFieldValue(serviceRole, companyId, LIVE_FIELD_KEYS.daysOnCarbon, String(streak.daysOnCarbon), systemUser);
          await setFieldValue(serviceRole, companyId, LIVE_FIELD_KEYS.freezesRemaining, String(streak.freezesRemaining), systemUser);

          // Milestones fire exactly once, guarded by check states. Day 5 is
          // in-app only; days 3 and 10 notify (owner + Carbon team).
          for (const milestone of STREAK_MILESTONES) {
            const reachedOn = streak.milestoneDates[milestone];
            if (!reachedOn) continue;
            const guard = await serviceRole
              .from("implementationCheckState")
              .select("id")
              .eq("companyId", companyId)
              .eq("itemKey", milestoneGuardKey(milestone))
              .maybeSingle();
            if (guard.data) continue;

            await setCheckState(serviceRole, companyId, milestoneGuardKey(milestone), "check", "1", systemUser);

            if (!(NOTIFYING_MILESTONES as readonly number[]).includes(milestone)) {
              continue;
            }

            const [recipient, name] = await Promise.all([
              ownerRecipient(serviceRole, hubRow),
              companyName(serviceRole, companyId)
            ]);
            if (recipient) {
              const email = StreakMilestoneEmail({
                recipientName: recipient.name,
                companyName: name,
                milestone,
                daysOnCarbon: streak.daysOnCarbon,
                hubUrl: hubUrl("live")
              });
              const html = await render(email);
              const text = await render(email, { plainText: true });
              await inngest.send({
                name: "carbon/send-email",
                data: {
                  to: [recipient.email],
                  cc: [CARBON_TEAM_EMAIL()],
                  subject:
                    milestone >= ACTIVATION_STREAK_DAYS
                      ? `🏆 ${name} is activated on Carbon`
                      : `🏆 Day ${milestone} on Carbon`,
                  html,
                  text,
                  companyId
                }
              });
            }
            try {
              await getSlackClient().sendMessage({
                channel: CARBON_TEAM_SLACK_CHANNEL(),
                text:
                  milestone >= ACTIVATION_STREAK_DAYS
                    ? `🏆 ${await companyName(serviceRole, companyId)} hit day ${milestone} — ACTIVATED`
                    : `🔥 ${await companyName(serviceRole, companyId)} hit day ${milestone} of their activation streak`
              });
            } catch (slackError) {
              logger.warn("Slack milestone ping failed", { slackError });
            }
          }

          // Activation: stamp it, complete the final gate, and let the closing
          // celebration + exit flow do the rest in-app.
          if (streak.activatedOn) {
            const activatedAt = await getFieldValue(serviceRole, companyId, LIVE_FIELD_KEYS.activatedAt);
            if (!activatedAt) {
              await setFieldValue(serviceRole, companyId, LIVE_FIELD_KEYS.activatedAt, streak.activatedOn, systemUser);
              await setCheckState(serviceRole, companyId, "gate:live", "gate", "done", systemUser);
              await setCheckState(serviceRole, companyId, "task:live-streak", "task", "done", systemUser);
            }
          }
        } catch (companyError) {
          logger.error("Usage scoring failed for company", {
            companyId,
            error: companyError
          });
        }
      }
    });
  }
);

// ---------------------------------------------------------------------------
// 2 · The Monday digest
// ---------------------------------------------------------------------------

export const implementationDigestFunction = inngest.createFunction(
  { id: "implementation-digest", retries: 2 },
  { cron: "0 12 * * 1" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();

    await step.run("send-digests", async () => {
      const hubs = await getHubs(serviceRole, ["tailoring", "shared", "active"]);

      for (const hub of hubs) {
        try {
          // Activated factories are done — the digest stops with the journey.
          const activatedAt = await getFieldValue(serviceRole, hub.id, LIVE_FIELD_KEYS.activatedAt);
          if (activatedAt) continue;

          const recipient = await ownerRecipient(serviceRole, hub);
          if (!recipient) continue;

          const states = await serviceRole
            .from("implementationCheckState")
            .select("itemKey, value")
            .eq("companyId", hub.id)
            .eq("kind", "gate");
          const progress = gateProgress(states.data ?? []);
          const goLiveDate = await getFieldValue(serviceRole, hub.id, "plan.gate:switch.gateDate");
          const name = await companyName(serviceRole, hub.id);

          const email = HubDigestEmail({
            recipientName: recipient.name,
            companyName: name,
            doneGates: progress.done,
            totalGates: progress.total,
            nextTitle: progress.next?.title ?? null,
            goLiveDate: goLiveDate ?? undefined,
            hubUrl: hubUrl()
          });
          const html = await render(email);
          const text = await render(email, { plainText: true });
          await inngest.send({
            name: "carbon/send-email",
            data: {
              to: [recipient.email],
              subject: progress.next
                ? `This week: ${progress.next.title}`
                : "This week on Carbon",
              html,
              text,
              companyId: hub.id
            }
          });
        } catch (companyError) {
          logger.error("Digest failed for company", {
            companyId: hub.id,
            error: companyError
          });
        }
      }
    });
  }
);

// ---------------------------------------------------------------------------
// 3 · Quiet detection
// ---------------------------------------------------------------------------

const NUDGE_EMAIL_AT = "nudge.emailAt";
const NUDGE_SLACK_AT = "nudge.slackAt";

async function lastHubActivity(serviceRole: Client, companyId: string) {
  const latest = async (
    table: "implementationCheckState" | "implementationFieldValue" | "implementationRow"
  ) => {
    const result = await serviceRole
      .from(table)
      .select("createdAt, updatedAt")
      .eq("companyId", companyId)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = result.data as { createdAt?: string; updatedAt?: string } | null;
    return [row?.createdAt, row?.updatedAt].filter(Boolean) as string[];
  };
  const stamps = (
    await Promise.all([
      latest("implementationCheckState"),
      latest("implementationFieldValue"),
      latest("implementationRow")
    ])
  ).flat();
  // Nudge guards themselves are field values; excluding them precisely isn't
  // worth the complexity — a nudge counts as "we reached out", and the next
  // one waits for a fresh quiet spell either way.
  return stamps.sort().pop() ?? null;
}

export const implementationNudgeFunction = inngest.createFunction(
  { id: "implementation-nudge", retries: 2 },
  { cron: "0 15 * * *" },
  async ({ step, logger }) => {
    const serviceRole = getCarbonServiceRole();

    await step.run("detect-quiet-factories", async () => {
      const hubs = await getHubs(serviceRole, ["tailoring", "shared", "active"]);

      for (const hub of hubs) {
        try {
          const liveAt = await getFieldValue(serviceRole, hub.id, LIVE_FIELD_KEYS.liveAt);
          if (liveAt) continue; // past cutover, the streak engine owns signals

          const last = await lastHubActivity(serviceRole, hub.id);
          if (!last) continue;
          const quietDays = Math.floor(
            (Date.now() - new Date(last).getTime()) / 86_400_000
          );
          if (quietDays < 7) continue;

          const states = await serviceRole
            .from("implementationCheckState")
            .select("itemKey, value")
            .eq("companyId", hub.id)
            .eq("kind", "gate");
          const progress = gateProgress(states.data ?? []);
          const name = await companyName(serviceRole, hub.id);

          if (quietDays >= 14) {
            const slackAt = await getFieldValue(serviceRole, hub.id, NUDGE_SLACK_AT);
            if (!slackAt || slackAt < last) {
              try {
                await getSlackClient().sendMessage({
                  channel: CARBON_TEAM_SLACK_CHANNEL(),
                  text: `😴 ${name} has been quiet for ${quietDays} days on their implementation (next: ${progress.next?.title ?? "finish line"}). Worth a human note.`
                });
              } catch (slackError) {
                logger.warn("Slack nudge failed", { slackError });
              }
              await setFieldValue(serviceRole, hub.id, NUDGE_SLACK_AT, new Date().toISOString(), hub.createdBy);
            }
            continue;
          }

          const emailAt = await getFieldValue(serviceRole, hub.id, NUDGE_EMAIL_AT);
          if (emailAt && emailAt >= last) continue; // already nudged this spell

          const recipient = await ownerRecipient(serviceRole, hub);
          if (!recipient) continue;

          const email = HubNudgeEmail({
            recipientName: recipient.name,
            companyName: name,
            nextTitle: progress.next?.title ?? null,
            quietDays,
            hubUrl: hubUrl()
          });
          const html = await render(email);
          const text = await render(email, { plainText: true });
          await inngest.send({
            name: "carbon/send-email",
            data: {
              to: [recipient.email],
              subject: progress.next
                ? `${progress.next.title} is waiting`
                : "Your Carbon plan is waiting",
              html,
              text,
              companyId: hub.id
            }
          });
          await setFieldValue(serviceRole, hub.id, NUDGE_EMAIL_AT, new Date().toISOString(), hub.createdBy);
        } catch (companyError) {
          logger.error("Nudge failed for company", {
            companyId: hub.id,
            error: companyError
          });
        }
      }
    });
  }
);
