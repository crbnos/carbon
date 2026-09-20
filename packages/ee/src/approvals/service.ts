import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { trackWorkEvent } from "@carbon/lib/telemetry";
import { getLogger } from "@carbon/logger";
import { getPurchaseOrderStatus, sanitize } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "../entitlements.server";
import { companyHasFeature } from "../plan.server";
import type { approvalDocumentType } from "./models";
import type {
  ApprovalFilters,
  ApprovalRequestForApproveCheck,
  ApprovalRequestForCancelCheck,
  ApprovalRequestForViewCheck,
  ApprovalRule,
  CreateApprovalRequestInput,
  UpsertApprovalRuleInput
} from "./types";

type GenericQueryFilters = {
  limit?: number;
  offset?: number;
  sorts?: string[];
  filters?: { column: string; operator: string; value: string }[];
};

const logger = getLogger("ee", "approvals");

export async function approveRequest(
  db: Kysely<KyselyDatabase>,
  id: string,
  userId: string,
  notes?: string
) {
  // Pre-flight check: verify approval request exists and is pending
  const approvalRequest = await db
    .selectFrom("approvalRequest")
    .select(["id", "status", "documentType", "documentId", "companyId"])
    .where("id", "=", id)
    .executeTakeFirst();

  if (!approvalRequest) {
    return { error: { message: "Approval request not found" }, data: null };
  }

  if (approvalRequest.status !== "Pending") {
    return {
      error: { message: "Approval request is not pending" },
      data: null
    };
  }

  const { documentType, documentId } = approvalRequest;
  const now = new Date().toISOString();

  try {
    const result = await db.transaction().execute(async (trx) => {
      // 1. Update approval request to "Approved"
      const updatedApproval = await trx
        .updateTable("approvalRequest")
        .set({
          status: "Approved",
          decisionBy: userId,
          decisionAt: now,
          decisionNotes: notes || null,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", id)
        .returning(["id", "documentType", "documentId"])
        .executeTakeFirstOrThrow();

      // 2. Update document status based on type
      if (documentType === "purchaseOrder") {
        // Fetch PO lines to calculate new status
        const lines = await trx
          .selectFrom("purchaseOrderLine")
          .select([
            "purchaseOrderLineType",
            "invoicedComplete",
            "receivedComplete"
          ])
          .where("purchaseOrderId", "=", documentId)
          .execute();

        const { status: calculatedStatus } = getPurchaseOrderStatus(lines);

        // Update PO status (only if currently "Needs Approval")
        const poUpdate = await trx
          .updateTable("purchaseOrder")
          .set({
            status: calculatedStatus,
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", documentId)
          .where("status", "=", "Needs Approval")
          .returning(["id"])
          .executeTakeFirst();

        if (!poUpdate) {
          throw new Error(
            "Failed to update purchase order status - it may no longer be in 'Needs Approval' state"
          );
        }
      } else if (documentType === "qualityDocument") {
        const qdUpdate = await trx
          .updateTable("qualityDocument")
          .set({
            status: "Active",
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", documentId)
          .returning(["id"])
          .executeTakeFirst();

        if (!qdUpdate) {
          throw new Error("Failed to update quality document status");
        }
      } else if (documentType === "supplier") {
        const supplierUpdate = await trx
          .updateTable("supplier")
          .set({
            supplierStatus: "Active",
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", documentId)
          .returning(["id"])
          .executeTakeFirst();

        if (!supplierUpdate) {
          throw new Error("Failed to update supplier status");
        }
      }

      return updatedApproval;
    });

    // After the transaction, so a rollback emits nothing. The order became
    // real here, not on the finalize route — that one stopped at the gate.
    // Without this, every order a customer routes through an approval
    // threshold is missing from "POs issued", and the shops that configure
    // approval thresholds are the larger ones.
    if (documentType === "purchaseOrder") {
      trackWorkEvent(
        "purchase_order_finalized",
        {
          companyId: approvalRequest.companyId,
          userId,
          purchaseOrderId: documentId,
          stage: "committed"
        },
        { discriminator: "committed" }
      );
    }

    return { data: result, error: null };
  } catch (error) {
    // Transaction automatically rolled back on error
    return {
      error: {
        message:
          error instanceof Error ? error.message : "Failed to process approval"
      },
      data: null
    };
  }
}

export async function canApproveRequest(
  client: SupabaseClient<Database>,
  approvalRequest: ApprovalRequestForApproveCheck,
  userId: string
): Promise<boolean> {
  const rules = await getApprovalRulesForApprover(
    client,
    approvalRequest.documentType,
    approvalRequest.companyId
  );

  if (!rules.data || rules.data.length === 0) {
    return false;
  }

  // Authority flows upward only. Find the tier that matches this request's
  // amount; a user may approve at that tier or any HIGHER tier, but never
  // from a lower one (a $1k approver must not approve a $1M order).
  // Amount-less document types (quality, supplier) match the base tier
  // (lowerBoundAmount 0), so every rule qualifies and behavior is unchanged.
  const matched = await getApprovalRuleByAmount(
    client,
    approvalRequest.documentType,
    approvalRequest.companyId,
    approvalRequest.amount ?? undefined
  );
  const tierFloor = matched.data?.lowerBoundAmount ?? 0;

  const userGroups = await client.rpc("groups_for_user", { uid: userId });
  const userGroupIds = userGroups.data || [];

  return rules.data
    .filter((rule) => (rule.lowerBoundAmount ?? 0) >= tierFloor)
    .some((rule) => {
      if (rule.defaultApproverId === userId) {
        return true;
      }

      const approverGroupIds = rule.approverGroupIds;
      if (!approverGroupIds || approverGroupIds.length === 0) {
        return false;
      }

      // Direct individual approver
      if (approverGroupIds.includes(userId)) {
        return true;
      }

      // Member of an approver group
      return approverGroupIds.some((groupId) => userGroupIds.includes(groupId));
    });
}

/**
 * Checks if a user can approve a request based on the specific rule matching the amount.
 * This is the original approval check logic - user must be on the rule that matches the amount.
 * Used for "Assigned to Me" lists.
 */
export async function canApproveRequestInWindow(
  client: SupabaseClient<Database>,
  approvalRequest: ApprovalRequestForApproveCheck,
  userId: string
): Promise<boolean> {
  const rule = await getApprovalRuleByAmount(
    client,
    approvalRequest.documentType,
    approvalRequest.companyId,
    approvalRequest.amount ?? undefined
  );

  if (!rule.data) {
    return false;
  }

  if (rule.data.defaultApproverId === userId) {
    return true;
  }

  const approverGroupIds = rule.data.approverGroupIds;
  if (!approverGroupIds || approverGroupIds.length === 0) {
    return false;
  }

  // Check if user ID is directly in approverGroupIds (for individual approvers)
  if (approverGroupIds.includes(userId)) {
    return true;
  }

  // Check if user belongs to any of the approver groups
  const userGroups = await client.rpc("groups_for_user", { uid: userId });
  const userGroupIds = userGroups.data || [];
  return approverGroupIds.some((groupId) => userGroupIds.includes(groupId));
}

export function canCancelRequest(
  approvalRequest: ApprovalRequestForCancelCheck,
  userId: string
): boolean {
  return (
    approvalRequest.requestedBy === userId &&
    approvalRequest.status === "Pending"
  );
}

export async function cancelApprovalRequest(
  client: SupabaseClient<Database>,
  id: string,
  userId: string
) {
  const existing = await client
    .from("approvalRequest")
    .select("id, status, requestedBy")
    .eq("id", id)
    .single();

  if (existing.error || !existing.data) {
    return { error: { message: "Approval request not found" }, data: null };
  }

  if (existing.data.status !== "Pending") {
    return {
      error: { message: "Approval request is not pending" },
      data: null
    };
  }

  if (existing.data.requestedBy !== userId) {
    return {
      error: { message: "Only the requester can cancel an approval request" },
      data: null
    };
  }

  return client
    .from("approvalRequest")
    .update({
      status: "Cancelled",
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

export async function canViewApprovalRequest(
  client: SupabaseClient<Database>,
  approvalRequest: ApprovalRequestForViewCheck,
  userId: string
): Promise<boolean> {
  if (approvalRequest.requestedBy === userId) {
    return true;
  }

  return canApproveRequest(
    client,
    {
      amount: approvalRequest.amount,
      documentType: approvalRequest.documentType,
      companyId: approvalRequest.companyId
    },
    userId
  );
}

export async function createApprovalRequest(
  client: SupabaseClient<Database>,
  request: CreateApprovalRequestInput & { amount?: number }
) {
  return client
    .from("approvalRequest")
    .insert([
      {
        documentType: request.documentType,
        documentId: request.documentId,
        requestedBy: request.requestedBy,
        amount: request.amount ?? null,
        companyId: request.companyId,
        createdBy: request.createdBy
      }
    ])
    .select("id")
    .single();
}

export async function deleteApprovalRule(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  await requireEntitlement(client, companyId, "APPROVAL_RULES");
  return client
    .from("approvalRule")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

export async function getApprovalById(
  client: SupabaseClient<Database>,
  id: string
) {
  const baseRequest = await client
    .from("approvalRequest")
    .select("*")
    .eq("id", id)
    .single();

  if (baseRequest.error || !baseRequest.data) {
    return baseRequest;
  }

  const viewData = await client
    .from("approvalRequests")
    .select("documentReadableId, documentDescription")
    .eq("id", id)
    .single();

  return {
    data: {
      ...baseRequest.data,
      documentReadableId: viewData.data?.documentReadableId ?? null,
      documentDescription: viewData.data?.documentDescription ?? null
    },
    error: null
  };
}

export async function getApprovalRequestsByDocument(
  client: SupabaseClient<Database>,
  documentType: (typeof approvalDocumentType)[number],
  documentId: string
) {
  return client
    .from("approvalRequests")
    .select("*")
    .eq("documentType", documentType)
    .eq("documentId", documentId)
    .order("requestedAt", { ascending: false });
}

export async function getApprovalRuleByAmount(
  client: SupabaseClient<Database>,
  documentType: (typeof approvalDocumentType)[number],
  companyId: string,
  amount?: number
) {
  if (
    !(await companyHasFeature(client, companyId, { feature: "APPROVAL_RULES" }))
  ) {
    return { data: null, error: null };
  }

  let query = client
    .from("approvalRule")
    .select("*")
    .eq("documentType", documentType)
    .eq("companyId", companyId)
    .eq("enabled", true);

  if (amount !== undefined && amount !== null) {
    // The matching tier is the highest one whose floor is at or below the
    // amount; the next tier's floor is where its coverage ends.
    query = query.lte("lowerBoundAmount", amount);
  } else {
    query = query.eq("lowerBoundAmount", 0);
  }

  return query
    .order("lowerBoundAmount", { ascending: false })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
}

export async function getApproverUserIdsForRule(
  client: SupabaseClient<Database>,
  rule: Pick<ApprovalRule, "approverGroupIds" | "defaultApproverId">
): Promise<string[]> {
  const groupIds = rule.approverGroupIds?.filter(Boolean) ?? [];
  const defaultId = rule.defaultApproverId ?? null;

  const fromGroups =
    groupIds.length > 0
      ? await client.rpc("users_for_groups", { groups: groupIds })
      : { data: [] as string[], error: null };

  if (fromGroups.error) {
    logger.error(
      "getApproverUserIdsForRule: users_for_groups failed",
      fromGroups.error
    );
    return defaultId ? [defaultId] : [];
  }

  const ids = Array.isArray(fromGroups.data)
    ? (fromGroups.data as string[])
    : [];
  const combined = defaultId
    ? [...new Set([...ids, defaultId])]
    : [...new Set(ids)];
  return combined;
}

/**
 * "Notified of spend" cascade resolver. When a tiered approval lands at
 * a high tier, approvers of every enabled rule with a strictly lower
 * `lowerBoundAmount` get pinged — visibility into spend that bypassed
 * their tier. Returns deduped user IDs.
 */
export async function getLowerTierApproverUserIds(
  client: SupabaseClient<Database>,
  documentType: (typeof approvalDocumentType)[number],
  companyId: string,
  amount: number | null | undefined
): Promise<string[]> {
  if (amount == null) return [];

  const matched = await getApprovalRuleByAmount(
    client,
    documentType,
    companyId,
    amount
  );
  if (!matched.data) return [];

  const lowerRules = await client
    .from("approvalRule")
    .select("approverGroupIds, defaultApproverId")
    .eq("documentType", documentType)
    .eq("companyId", companyId)
    .eq("enabled", true)
    .lt("lowerBoundAmount", matched.data.lowerBoundAmount ?? 0);

  if (lowerRules.error || !lowerRules.data?.length) return [];

  const expanded = await Promise.all(
    lowerRules.data.map((rule) => getApproverUserIdsForRule(client, rule))
  );
  return [...new Set(expanded.flat())];
}

export async function getApprovalRuleById(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("approvalRule")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getApprovalRules(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("approvalRule").select("*").eq("companyId", companyId);
}

export async function getApprovalRulesForApprover(
  client: SupabaseClient<Database>,
  documentType: (typeof approvalDocumentType)[number],
  companyId: string
) {
  return client
    .from("approvalRule")
    .select("*")
    .eq("documentType", documentType)
    .eq("companyId", companyId)
    .eq("enabled", true)
    .order("lowerBoundAmount", { ascending: false });
}

export async function getApprovalsForUser(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string,
  args?: GenericQueryFilters & ApprovalFilters
) {
  let query = client
    .from("approvalRequest")
    .select("*", { count: "exact" })
    .eq("companyId", companyId)
    .eq("requestedBy", userId);

  if (args?.documentType) {
    query = query.eq("documentType", args.documentType);
  }

  if (args?.status) {
    query = query.eq("status", args.status);
  }

  if (args?.dateFrom) {
    query = query.gte("requestedAt", args.dateFrom);
  }
  if (args?.dateTo) {
    query = query.lte("requestedAt", args.dateTo);
  }

  const requestedByUserBase = await query;

  // Get readable fields from view for requestedByUser
  const requestedByUser = await Promise.all(
    (requestedByUserBase.data || []).map(async (approval) => {
      const viewData = await client
        .from("approvalRequests")
        .select("documentReadableId, documentDescription")
        .eq("id", approval.id)
        .single();

      return {
        ...approval,
        documentReadableId: viewData.data?.documentReadableId ?? null,
        documentDescription: viewData.data?.documentDescription ?? null
      };
    })
  );

  let pendingQuery = client
    .from("approvalRequest")
    .select("*")
    .eq("companyId", companyId)
    .eq("status", "Pending")
    .neq("requestedBy", userId);

  if (args?.documentType) {
    pendingQuery = pendingQuery.eq("documentType", args.documentType);
  }

  if (args?.dateFrom) {
    pendingQuery = pendingQuery.gte("requestedAt", args.dateFrom);
  }
  if (args?.dateTo) {
    pendingQuery = pendingQuery.lte("requestedAt", args.dateTo);
  }

  const allPending = await pendingQuery;

  const pendingWithReadableFields = await Promise.all(
    (allPending.data || []).map(async (approval) => {
      const viewData = await client
        .from("approvalRequests")
        .select("documentReadableId, documentDescription")
        .eq("id", approval.id)
        .single();

      return {
        ...approval,
        documentReadableId: viewData.data?.documentReadableId ?? null,
        documentDescription: viewData.data?.documentDescription ?? null
      };
    })
  );

  const canApprovePromises = pendingWithReadableFields.map(async (approval) => {
    const canApprove = await canApproveRequest(
      client,
      {
        amount: approval.amount,
        documentType: approval.documentType,
        companyId: approval.companyId
      },
      userId
    );
    return canApprove ? approval : null;
  });

  const approvableByUser = (await Promise.all(canApprovePromises)).filter(
    (approval): approval is NonNullable<typeof approval> => approval !== null
  );

  const allApprovals = [...requestedByUser, ...approvableByUser];

  let filtered = allApprovals;
  if (args?.status && args.status !== "Pending") {
    filtered = allApprovals.filter((a) => a.status === args.status);
  }

  filtered.sort((a, b) => {
    const aDate = new Date(a.requestedAt).getTime();
    const bDate = new Date(b.requestedAt).getTime();
    return bDate - aDate;
  });

  if (args?.limit) {
    const offset = args.offset || 0;
    filtered = filtered.slice(offset, offset + args.limit);
  }

  return {
    data: filtered,
    count: requestedByUserBase.count ?? allApprovals.length,
    error: null
  };
}

export async function getLatestApprovalRequestForDocument(
  client: SupabaseClient<Database>,
  documentType: (typeof approvalDocumentType)[number],
  documentId: string
) {
  const baseRequest = await client
    .from("approvalRequest")
    .select("*")
    .eq("documentType", documentType)
    .eq("documentId", documentId)
    .eq("status", "Pending")
    .order("requestedAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (baseRequest.error || !baseRequest.data) {
    return baseRequest;
  }

  const viewData = await client
    .from("approvalRequests")
    .select("documentReadableId, documentDescription")
    .eq("id", baseRequest.data.id)
    .single();

  return {
    data: {
      ...baseRequest.data,
      documentReadableId: viewData.data?.documentReadableId ?? null,
      documentDescription: viewData.data?.documentDescription ?? null
    },
    error: null
  };
}

export async function getPendingApprovalsForApprover(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  const allPending = await client
    .from("approvalRequest")
    .select("*")
    .eq("companyId", companyId)
    .eq("status", "Pending")
    .order("requestedAt", { ascending: false });

  if (allPending.error || !allPending.data) {
    return allPending;
  }

  const pendingWithReadableFields = await Promise.all(
    allPending.data.map(async (approval) => {
      const viewData = await client
        .from("approvalRequests")
        .select("documentReadableId, documentDescription")
        .eq("id", approval.id)
        .single();

      return {
        ...approval,
        documentReadableId: viewData.data?.documentReadableId ?? null,
        documentDescription: viewData.data?.documentDescription ?? null
      };
    })
  );

  // Use canApproveRequestInWindow to only show requests within user's specific
  // approval window. That check relies on the amount-matched rule, which
  // getApprovalRuleByAmount suppresses when APPROVAL_RULES is not entitled — so
  // a company that configured rules and then downgraded would lose every
  // in-flight pending request from this queue even though the document detail
  // route (canApproveRequest, which does not degrade) can still approve them.
  // Fall back to canApproveRequest when the feature is unavailable so existing
  // approvals stay discoverable; entitled companies keep the exact window check.
  const approvalRulesEnabled = await companyHasFeature(client, companyId, {
    feature: "APPROVAL_RULES"
  });
  const canApprovePromises = pendingWithReadableFields.map(async (approval) => {
    const approvalCheck = {
      amount: approval.amount,
      documentType: approval.documentType,
      companyId: approval.companyId
    };
    const canApprove = approvalRulesEnabled
      ? await canApproveRequestInWindow(client, approvalCheck, userId)
      : await canApproveRequest(client, approvalCheck, userId);
    return canApprove ? approval : null;
  });

  const approvableByUser = (await Promise.all(canApprovePromises)).filter(
    (approval): approval is NonNullable<typeof approval> => approval !== null
  );

  return {
    data: approvableByUser,
    error: null
  };
}

export async function hasPendingApproval(
  client: SupabaseClient<Database>,
  documentType: (typeof approvalDocumentType)[number],
  documentId: string
): Promise<boolean> {
  const result = await client
    .from("approvalRequest")
    .select("id")
    .eq("documentType", documentType)
    .eq("documentId", documentId)
    .eq("status", "Pending")
    .limit(1);

  return (result.data?.length ?? 0) > 0;
}

export async function isApprovalRequired(
  client: SupabaseClient<Database>,
  documentType: (typeof approvalDocumentType)[number],
  companyId: string,
  amount?: number
): Promise<boolean> {
  const config = await getApprovalRuleByAmount(
    client,
    documentType,
    companyId,
    amount
  );

  if (!config.data) {
    return false;
  }

  return config.data.enabled;
}

export async function rejectRequest(
  db: Kysely<KyselyDatabase>,
  id: string,
  userId: string,
  notes?: string
) {
  // Pre-flight check: verify approval request exists and is pending
  const approvalRequest = await db
    .selectFrom("approvalRequest")
    .select(["id", "status", "documentType", "documentId"])
    .where("id", "=", id)
    .executeTakeFirst();

  if (!approvalRequest) {
    return { error: { message: "Approval request not found" }, data: null };
  }

  if (approvalRequest.status !== "Pending") {
    return {
      error: { message: "Approval request is not pending" },
      data: null
    };
  }

  const { documentType, documentId } = approvalRequest;
  const now = new Date().toISOString();

  try {
    const result = await db.transaction().execute(async (trx) => {
      // 1. Update approval request to "Rejected"
      const updatedApproval = await trx
        .updateTable("approvalRequest")
        .set({
          status: "Rejected",
          decisionBy: userId,
          decisionAt: now,
          decisionNotes: notes || null,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", id)
        .returning(["id", "documentType", "documentId"])
        .executeTakeFirstOrThrow();

      // 2. Update document status based on type
      if (documentType === "purchaseOrder") {
        const poUpdate = await trx
          .updateTable("purchaseOrder")
          .set({
            status: "Rejected",
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", documentId)
          .where("status", "=", "Needs Approval")
          .returning(["id"])
          .executeTakeFirst();

        if (!poUpdate) {
          throw new Error(
            "Failed to update purchase order status - it may no longer be in 'Needs Approval' state"
          );
        }
      }
      // Note: qualityDocument rejection doesn't change status (stays Draft)

      if (documentType === "supplier") {
        const supplierUpdate = await trx
          .updateTable("supplier")
          .set({
            supplierStatus: "Rejected",
            updatedBy: userId,
            updatedAt: now
          })
          .where("id", "=", documentId)
          .returning(["id"])
          .executeTakeFirst();

        if (!supplierUpdate) {
          throw new Error("Failed to update supplier status");
        }
      }

      return updatedApproval;
    });

    return { data: result, error: null };
  } catch (error) {
    // Transaction automatically rolled back on error
    return {
      error: {
        message:
          error instanceof Error ? error.message : "Failed to process rejection"
      },
      data: null
    };
  }
}

export async function upsertApprovalRule(
  client: SupabaseClient<Database>,
  rule: UpsertApprovalRuleInput
) {
  if ("id" in rule) {
    const existing = await client
      .from("approvalRule")
      .select("companyId")
      .eq("id", rule.id)
      .single();

    if (existing.error || !existing.data) {
      return {
        data: null,
        error: existing.error || { message: "Rule not found" }
      };
    }

    await requireEntitlement(client, existing.data.companyId, "APPROVAL_RULES");

    return client
      .from("approvalRule")
      .update(sanitize(rule))
      .eq("id", rule.id)
      .eq("companyId", existing.data.companyId)
      .select("id")
      .single();
  }

  await requireEntitlement(client, rule.companyId, "APPROVAL_RULES");

  return client.from("approvalRule").insert([rule]).select("id").single();
}
