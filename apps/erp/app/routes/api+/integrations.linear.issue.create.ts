// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getAppUrl } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  isSyncedEntityType,
  syncedEntities,
  syncedEntityPermissions
} from "@carbon/ee/issue-sync";
import { linkNewIssue } from "@carbon/ee/issue-sync.server";
import { getCompanyEmployees, getLinearClient } from "@carbon/ee/linear.server";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data } from "react-router";
import { requireChangeNoticeEditable } from "~/modules/items/items.server";
import {
  getActionTaskWithParent,
  getNewIssueDefaults,
  projectElementLinkRefusal
} from "~/modules/shared/shared.server";

const logger = getLogger("erp", "integrations-linear-issue-create");

const linear = getLinearClient();

export const action: ActionFunction = async ({ request }) => {
  try {
    const data = await request.formData();

    const actionId = data.get("actionId") as string;
    const entityType = data.get("entityType") as string | null;

    if (!isSyncedEntityType(entityType)) {
      return { success: false, message: "Invalid entityType" };
    }

    const { companyId, client } = await requirePermissions(
      request,
      syncedEntityPermissions(entityType)
    );

    const teamId = data.get("teamId") as string;
    const title = data.get("title") as string;
    const description = data.get("description") as string;
    const assigneeId = data.get("assignee") as string;

    const carbonIssue = await getActionTaskWithParent(
      client,
      entityType,
      actionId,
      companyId
    );

    if (entityType === "changeOrderActionTask") {
      const locked = carbonIssue.parentId
        ? await requireChangeNoticeEditable(client, {
            changeNoticeId: carbonIssue.parentId,
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

    const issue = await linear.createIssue(companyId, {
      teamId,
      title,
      description: description || undefined,
      assigneeId: assigneeId || null
    });

    if (!issue) {
      return { success: false, message: "Issue not found" };
    }

    const linked = await linkNewIssue(getCarbonServiceRole(), {
      companyId,
      tracker: "linear",
      entityType,
      entityId: actionId,
      issueId: issue.id
    });

    if ("error" in linked) {
      return { success: false, message: linked.error };
    }

    const url =
      getAppUrl() +
      syncedEntities[entityType].detailPath(
        carbonIssue.parentId ?? "",
        actionId
      );

    await linear.createAttachmentLink(companyId, {
      issueId: issue.id,
      url,
      title: `Linked Carbon Issue: ${carbonIssue.parentReadableId ?? ""}`
    });

    // The first push runs under the per-company sync key.
    await trigger("issue-sync-push", {
      companyId,
      initial: true,
      records: [
        {
          table: entityType,
          recordId: actionId,
          operation: "UPDATE",
          old: null
        }
      ]
    });

    return new Response("Linear issue created");
  } catch (error) {
    logger.error("Linear issue action error", { error: error });
    return data(
      { success: false, message: "Failed to create issue" },
      { status: 400 }
    );
  }
};

export const loader: LoaderFunction = async ({ request }) => {
  const { companyId, client } = await requirePermissions(request, {});

  const url = new URL(request.url);

  // The record the dialog was opened from: its title and description
  // prefill the form (getNewIssueDefaults).
  const actionId = url.searchParams.get("actionId");
  const entityType = url.searchParams.get("entityType");
  const defaults =
    actionId && isSyncedEntityType(entityType)
      ? await getNewIssueDefaults(client, entityType, actionId, companyId)
      : null;

  const teamId = url.searchParams.get("teamId") as string;
  const teams = await linear.listTeams(companyId);

  if (teamId) {
    const members = teamId
      ? await linear.listTeamMembers(companyId, teamId)
      : [];
    const employees = await getCompanyEmployees(
      client,
      companyId,
      members.map((m) => m.email)
    );

    // I am sure we can improve this filtering step
    return {
      defaults,
      teams,
      members: members.filter((m) =>
        employees.some((v) => {
          if (!v.user?.email || !m.email) {
            return false;
          }
          return v.user.email.toLowerCase() === m.email.toLowerCase();
        })
      )
    };
  }

  return { teams, defaults };
};
