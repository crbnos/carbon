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

type ApprovalReminderEvent = {
  name: "carbon/notify";
  data: {
    event: NotificationEvent;
    companyId: string;
    documentId: string;
    documentType: ApprovalDocumentType;
    recipient: { type: "users"; userIds: string[] };
  };
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

async function escalateCompany(
  client: ReturnType<typeof getCarbonServiceRole>,
  companyId: string,
  now: Date,
  startOfToday: Date
): Promise<{ remindersSent: number }> {
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
    return { remindersSent: 0 };
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
    return { remindersSent: 0 };
  }

  const events: ApprovalReminderEvent[] = [];
  const dueRequestIds: string[] = [];

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

    events.push({
      name: "carbon/notify",
      data: {
        event: NotificationEvent.ApprovalRequested,
        companyId,
        documentId: request.documentId,
        documentType: request.documentType,
        recipient: { type: "users", userIds }
      }
    });
    dueRequestIds.push(request.id);
  }

  if (events.length === 0) {
    return { remindersSent: 0 };
  }

  await inngest.send(events);

  const nowIso = now.toISOString();
  const { error: updateError } = await (client.from as any)("approvalRequest")
    .update({ lastRemindedAt: nowIso })
    .in("id", dueRequestIds)
    .eq("companyId", companyId);

  if (updateError) {
    console.error(
      `approval-escalation: failed to stamp lastRemindedAt for company ${companyId}`,
      updateError
    );
  }

  return { remindersSent: events.length };
}

export const approvalEscalationFunction = inngest.createFunction(
  { id: "approval-escalation", retries: 2 },
  { cron: "0 5 * * *" },
  async ({ step }) => {
    const results = await step.run("escalate-approvals", async () => {
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

      const summary = {
        companiesProcessed: 0,
        remindersSent: 0,
        errors: 0
      };

      for (const company of (companies as { id: string }[]) ?? []) {
        try {
          const { remindersSent } = await escalateCompany(
            client,
            company.id,
            now,
            startOfToday
          );
          summary.companiesProcessed++;
          summary.remindersSent += remindersSent;
        } catch (error) {
          console.error(
            `Failed to escalate approvals for company ${company.id}`,
            error
          );
          summary.errors++;
        }
      }

      console.log("Approval escalation task completed", summary);
      return summary;
    });

    return results;
  }
);
