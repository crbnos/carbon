import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { NotificationEvent } from "@carbon/notifications";
import { inngest } from "../../client";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type ApprovalDocumentType = Database["public"]["Enums"]["approvalDocumentType"];

type ApprovalRuleRow = Database["public"]["Tables"]["approvalRule"]["Row"];

// `lastRemindedAt` is added by a parallel migration and may not be present in
// the generated types yet, so we type the request rows we care about here.
type ApprovalRequestRow = {
  id: string;
  documentType: ApprovalDocumentType;
  documentId: string;
  amount: number | null;
  requestedAt: string;
  lastRemindedAt: string | null;
};

// A single due reminder, collected in a read-only step and JSON-serialized back
// out so the (non-idempotent) send + stamp can run in their own memoized steps.
type ReminderDescriptor = {
  requestId: string;
  companyId: string;
  documentId: string;
  documentType: ApprovalDocumentType;
  userIds: string[];
};

// Mirror of `getApprovalRuleByAmount`: the matching tier is the enabled rule
// with the greatest `lowerBoundAmount` at or below the request amount (or
// `lowerBoundAmount === 0` when the amount is null), tie-broken by `id`.
function resolveMatchingRule(
  rules: ApprovalRuleRow[],
  amount: number | null
): ApprovalRuleRow | null {
  const candidates = rules
    .filter((rule) =>
      amount === null || amount === undefined
        ? rule.lowerBoundAmount === 0
        : rule.lowerBoundAmount <= amount
    )
    .sort((a, b) => {
      if (b.lowerBoundAmount !== a.lowerBoundAmount) {
        return b.lowerBoundAmount - a.lowerBoundAmount;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  return candidates[0] ?? null;
}

// Mirror of `getApproverUserIdsForRule`: expand the rule's approver groups via
// the `users_for_groups` RPC and add the `defaultApproverId`, deduped.
async function resolveApproverUserIds(
  client: ReturnType<typeof getCarbonServiceRole>,
  rule: Pick<ApprovalRuleRow, "approverGroupIds" | "defaultApproverId">
): Promise<string[]> {
  const groupIds = rule.approverGroupIds?.filter(Boolean) ?? [];
  const defaultId = rule.defaultApproverId ?? null;

  let ids: string[] = [];
  if (groupIds.length > 0) {
    const { data, error } = await client.rpc("users_for_groups", {
      groups: groupIds
    });
    if (error) {
      console.error("approval-escalation: users_for_groups failed", error);
      return defaultId ? [defaultId] : [];
    }
    ids = Array.isArray(data) ? (data as string[]) : [];
  }

  return defaultId ? [...new Set([...ids, defaultId])] : [...new Set(ids)];
}

// Read-only: resolve which pending requests are due for a reminder today. The
// actual notify send and the lastRemindedAt stamp are deliberately kept OUT of
// here so they can each run in their own memoized Inngest step (see below) —
// this function may be re-run freely on retry without side effects.
async function collectCompanyReminders(
  client: ReturnType<typeof getCarbonServiceRole>,
  companyId: string,
  now: Date,
  startOfToday: Date
): Promise<ReminderDescriptor[]> {
  // All enabled rules for the company — we need the full set to resolve the
  // matching tier before checking whether that tier opts into escalation.
  const { data: rulesData, error: rulesError } = await client
    .from("approvalRule")
    .select("*")
    .eq("companyId", companyId)
    .eq("enabled", true);

  if (rulesError) {
    throw new Error(`Failed to fetch approval rules: ${rulesError.message}`);
  }

  const rules = (rulesData as ApprovalRuleRow[]) ?? [];
  if (rules.length === 0) {
    return [];
  }

  const rulesByDocumentType = new Map<
    ApprovalDocumentType,
    ApprovalRuleRow[]
  >();
  for (const rule of rules) {
    const bucket = rulesByDocumentType.get(rule.documentType) ?? [];
    bucket.push(rule);
    rulesByDocumentType.set(rule.documentType, bucket);
  }

  const { data: requestsData, error: requestsError } = await (
    client.from as any
  )("approvalRequest")
    .select("id, documentType, documentId, amount, requestedAt, lastRemindedAt")
    .eq("companyId", companyId)
    .eq("status", "Pending");

  if (requestsError) {
    throw new Error(
      `Failed to fetch approval requests: ${requestsError.message}`
    );
  }

  const requests = (requestsData as ApprovalRequestRow[]) ?? [];
  if (requests.length === 0) {
    return [];
  }

  const reminders: ReminderDescriptor[] = [];

  for (const request of requests) {
    const matched = resolveMatchingRule(
      rulesByDocumentType.get(request.documentType) ?? [],
      request.amount
    );

    if (!matched || matched.escalationDays === null) continue;

    // Only escalate once the request has been pending longer than the tier's
    // escalation window.
    const escalationThreshold = new Date(
      now.getTime() - matched.escalationDays * MS_PER_DAY
    );
    if (new Date(request.requestedAt) >= escalationThreshold) continue;

    // At most one reminder per request per day.
    if (
      request.lastRemindedAt &&
      new Date(request.lastRemindedAt) >= startOfToday
    ) {
      continue;
    }

    const userIds = await resolveApproverUserIds(client, matched);
    if (userIds.length === 0) continue;

    reminders.push({
      requestId: request.id,
      companyId,
      documentId: request.documentId,
      documentType: request.documentType,
      userIds
    });
  }

  return reminders;
}

export const approvalEscalationFunction = inngest.createFunction(
  { id: "approval-escalation", retries: 2 },
  { cron: "0 5 * * *" },
  async ({ step }) => {
    // Step 1 — collect (read-only, idempotent). The wall-clock timestamps are
    // captured HERE, inside the step, so their memoized values stay stable if a
    // later step fails and the function replays (top-level `new Date()` would
    // drift across replays and corrupt the once-per-day id/stamp).
    const collected = await step.run("collect-reminders", async () => {
      const client = getCarbonServiceRole();

      const now = new Date();
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);

      const { data: companies, error: companiesError } = await client
        .from("company")
        .select("id");

      if (companiesError) {
        console.error("Failed to fetch companies", companiesError);
        throw new Error(`Failed to fetch companies: ${companiesError.message}`);
      }

      const reminders: ReminderDescriptor[] = [];
      let companiesProcessed = 0;
      let errors = 0;

      for (const company of (companies as { id: string }[]) ?? []) {
        try {
          const companyReminders = await collectCompanyReminders(
            client,
            company.id,
            now,
            startOfToday
          );
          reminders.push(...companyReminders);
          companiesProcessed++;
        } catch (error) {
          console.error(
            `Failed to escalate approvals for company ${company.id}`,
            error
          );
          errors++;
        }
      }

      return {
        reminders,
        nowIso: now.toISOString(),
        startOfTodayIso: startOfToday.toISOString(),
        companiesProcessed,
        errors
      };
    });

    const { reminders, nowIso, startOfTodayIso, companiesProcessed, errors } =
      collected;

    if (reminders.length === 0) {
      const summary = { companiesProcessed, remindersSent: 0, errors };
      console.log("Approval escalation task completed", summary);
      return summary;
    }

    // Step 2 — send (not idempotent, so isolated in its own memoized step: once
    // this step succeeds a later failure/replay returns its cached result and
    // never re-sends). The stable per-request/day event `id` is a second guard —
    // Inngest drops any duplicate carrying the same id within its dedup window.
    const events = reminders.map((reminder) => ({
      id: `approval-reminder:${reminder.requestId}:${startOfTodayIso}`,
      name: "carbon/notify" as const,
      data: {
        event: NotificationEvent.ApprovalRequested,
        companyId: reminder.companyId,
        documentId: reminder.documentId,
        documentType: reminder.documentType,
        recipient: { type: "users" as const, userIds: reminder.userIds }
      }
    }));
    await step.sendEvent("send-reminders", events);

    // Step 3 — stamp lastRemindedAt so the once-per-day guard holds. Runs after
    // the memoized send, so re-running it never re-notifies.
    await step.run("stamp-reminded", async () => {
      const client = getCarbonServiceRole();

      const requestIdsByCompany = new Map<string, string[]>();
      for (const reminder of reminders) {
        const bucket = requestIdsByCompany.get(reminder.companyId) ?? [];
        bucket.push(reminder.requestId);
        requestIdsByCompany.set(reminder.companyId, bucket);
      }

      for (const [companyId, requestIds] of requestIdsByCompany) {
        const { error: updateError } = await (client.from as any)(
          "approvalRequest"
        )
          .update({ lastRemindedAt: nowIso })
          .in("id", requestIds)
          .eq("companyId", companyId);

        if (updateError) {
          console.error(
            `approval-escalation: failed to stamp lastRemindedAt for company ${companyId}`,
            updateError
          );
        }
      }
    });

    const summary = {
      companiesProcessed,
      remindersSent: reminders.length,
      errors
    };
    console.log("Approval escalation task completed", summary);
    return summary;
  }
);
