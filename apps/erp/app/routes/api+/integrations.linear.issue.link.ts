// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  isSyncedEntityType,
  syncedEntities,
  syncedEntityParentId,
  syncedEntityPermissions
} from "@carbon/ee/issue-sync";
import { linkExistingIssue } from "@carbon/ee/issue-sync.server";
import {
  getLinearClient,
  getLinearIssueFromExternalId,
  unlinkActionFromLinearIssue
} from "@carbon/ee/linear.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";
import { requireChangeNoticeEditable } from "~/modules/items/items.server";
import {
  getActionTaskWithParent,
  projectElementLinkRefusal
} from "~/modules/shared/shared.server";

const logger = getLogger("erp", "integrations-linear-issue-link");

const linear = getLinearClient();

export const action: ActionFunction = async ({ request }) => {
  try {
    const form = await request.formData();

    const actionId = form.get("actionId") as string;
    const entityType = form.get("entityType") as string | null;

    if (!actionId) {
      return { success: false, message: "Missing required fields: actionId" };
    }

    if (!isSyncedEntityType(entityType)) {
      return { success: false, message: "Invalid entityType" };
    }

    const { companyId, client } = await requirePermissions(
      request,
      syncedEntityPermissions(entityType)
    );

    if (entityType === "changeOrderActionTask") {
      const task = await getActionTaskWithParent(
        client,
        entityType,
        actionId,
        companyId
      );

      const locked = task.parentId
        ? await requireChangeNoticeEditable(client, {
            changeNoticeId: task.parentId,
            companyId,
            scope: "workflow"
          })
        : { error: { message: "Could not find change notice" } };

      if (locked) {
        return { success: false, message: locked.error.message };
      }
    }

    if (entityType === "projectElement") {
      const refusal = await projectElementLinkRefusal(
        client,
        actionId,
        companyId
      );
      if (refusal) {
        return { success: false, message: refusal };
      }
    }

    switch (request.method) {
      case "POST": {
        const issueId = form.get("issueId") as string;

        if (!issueId) {
          return {
            success: false,
            message: "Missing required fields: issueId"
          };
        }

        const linked = await linkExistingIssue(getCarbonServiceRole(), {
          companyId,
          tracker: "linear",
          entityType,
          entityId: actionId,
          issueId
        });

        if ("error" in linked) {
          return { success: false, message: linked.error };
        }

        const carbonIssue = await getActionTaskWithParent(
          client,
          entityType,
          actionId,
          companyId
        );

        const url =
          getAppUrl() +
          syncedEntities[entityType].detailPath(
            carbonIssue.parentId ?? "",
            actionId
          );

        await linear.createAttachmentLink(companyId, {
          issueId: String(linked.issue.id),
          url,
          title: `Linked Carbon Issue: ${carbonIssue.parentReadableId ?? ""}`
        });

        // Push the record's description (if it has one) under the
        // per-company sync key.
        await trigger("issue-sync-push", {
          companyId,
          records: [
            {
              table: entityType,
              recordId: actionId,
              operation: "UPDATE",
              old: null
            }
          ]
        });

        return { success: true, message: "Linked successfully" };
      }

      case "DELETE": {
        const linked = await getLinearIssueFromExternalId(
          client,
          companyId,
          actionId,
          entityType
        );

        // Unlink from Carbon's DB first
        const unlinked = await unlinkActionFromLinearIssue(client, companyId, {
          entityType,
          actionId
        });

        if (unlinked.error) {
          return { success: false, message: "Failed to unlink issue" };
        }

        // Best-effort: clean up attachment in Linear
        try {
          // Remove only this record's back-link: records of one project share
          // a URL prefix, so match the exact URL on this issue.
          const parentId = syncedEntityParentId(unlinked.data, entityType);

          if (parentId && linked) {
            await linear.removeIssueLink(
              companyId,
              linked.id,
              getAppUrl() +
                syncedEntities[entityType].detailPath(parentId, actionId)
            );
          }
        } catch (e) {
          logger.error("Failed to clean up Linear attachment", { error: e });
        }

        return { success: true, message: "Unlinked successfully" };
      }
    }
  } catch (error) {
    logger.error("Linear issue link action error", { error: error });
    return data(
      { success: false, message: `Failed to process request` },
      { status: 400 }
    );
  }
};

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);

  const entityType = url.searchParams.get("entityType");

  if (!isSyncedEntityType(entityType)) {
    return { issues: [] };
  }

  const { companyId } = await requirePermissions(
    request,
    syncedEntityPermissions(entityType)
  );

  const query = url.searchParams.get("search") as string;

  const issues = await linear.listIssues(companyId, query);

  return { issues };
};
