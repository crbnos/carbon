// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  cancelPendingApprovals,
  openApprovalRequests
} from "@carbon/ee/approvals/document.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { unchecked } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { qualityDocumentStatus } from "~/modules/quality/quality.models";

const logger = getLogger("erp", "update");

type DocRow = { id: string; status: string | null };

/**
 * Draft or Archived → Active. With an approval rule, each document opens a
 * request and waits in Draft (an Archived one moves to Draft) until it is
 * approved; without one it goes Active at once.
 */
async function processToActive(
  client: SupabaseClient<Database>,
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  docList: DocRow[],
  ids: string[]
) {
  const transitioning = docList.filter(
    (doc) => doc.status === "Draft" || doc.status === "Archived"
  );
  const opened =
    transitioning.length > 0
      ? await openApprovalRequests(serviceRole, {
          documentType: "qualityDocument",
          documentIds: transitioning.map((doc) => doc.id),
          companyId,
          userId
        })
      : ({ status: "not-required" } as const);

  if (opened.status === "failed") {
    return {
      data: null,
      error: { message: "Failed to submit for approval" }
    } as const;
  }

  const awaitingApproval = new Set(
    opened.status === "opened" ? transitioning.map((doc) => doc.id) : []
  );

  if (opened.status === "opened" && opened.requested.length > 0) {
    if (opened.approverIds.length > 0) {
      for (const documentId of opened.requested) {
        await trigger("notify", {
          event: NotificationEvent.ApprovalRequested,
          companyId,
          documentId,
          documentType: "qualityDocument",
          recipient: { type: "users", userIds: opened.approverIds },
          from: userId
        }).catch((e) =>
          logger.error("Failed to trigger approval notification", {
            companyId,
            documentId,
            error: e
          })
        );
      }
    }

    const archivedToDraft = transitioning
      .filter(
        (doc) => doc.status === "Archived" && opened.requested.includes(doc.id)
      )
      .map((doc) => doc.id);
    if (archivedToDraft.length > 0) {
      await client
        .from("qualityDocument")
        .update({
          status: "Draft",
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", archivedToDraft)
        .eq("companyId", companyId);
    }
  }

  const idsToUpdateToActive = ids.filter((id) => !awaitingApproval.has(id));
  if (idsToUpdateToActive.length === 0) {
    return { data: null, error: null } as const;
  }
  return client
    .from("qualityDocument")
    .update({
      status: "Active",
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .in("id", idsToUpdateToActive)
    .eq("companyId", companyId);
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const serviceRole = getCarbonServiceRole();
  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof field !== "string" || typeof value !== "string") {
    return { error: { message: "Invalid form data" }, data: null };
  }

  switch (field) {
    case "content":
    case "name":
      return await client
        .from("qualityDocument")
        .update(
          unchecked({
            [field]: value,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
        )
        .in("id", ids as string[])
        .eq("companyId", companyId);
    case "status": {
      const statusValue = value as (typeof qualityDocumentStatus)[number];
      if (!qualityDocumentStatus.includes(statusValue)) {
        return { error: { message: "Invalid status" }, data: null };
      }

      const currentDocs = await client
        .from("qualityDocument")
        .select("id, status")
        .in("id", ids as string[])
        // docList drives service-role approval writes below — this company's
        // documents only.
        .eq("companyId", companyId);

      if (currentDocs.error) {
        return { error: currentDocs.error, data: null };
      }

      const docList = (currentDocs.data ?? []) as DocRow[];
      const idList = ids as string[];

      if (statusValue === "Active") {
        return processToActive(
          client,
          serviceRole,
          companyId,
          userId,
          docList,
          idList
        );
      }

      // Archiving withdraws a pending request for anyone who may update the
      // document; sending it back to Draft is a withdrawal only the requester
      // or an approver may make.
      if (
        (statusValue === "Archived" || statusValue === "Draft") &&
        docList.length > 0
      ) {
        const cancelled = await cancelPendingApprovals(serviceRole, {
          documentType: "qualityDocument",
          documentIds: docList.map((doc) => doc.id),
          companyId,
          userId,
          onlyRequesterOrApprover: statusValue === "Draft"
        });
        if (cancelled.error) {
          return { error: { message: cancelled.error.message }, data: null };
        }
      }

      return await client
        .from("qualityDocument")
        .update({
          status: statusValue,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", idList)
        .eq("companyId", companyId);
    }
    case "tags":
      return await client
        .from("qualityDocument")
        .update({
          [field]: formData.getAll("value") as string[],
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .in("id", ids as string[])
        .eq("companyId", companyId);

    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}
