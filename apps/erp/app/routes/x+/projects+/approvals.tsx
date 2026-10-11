// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { msg } from "@lingui/core/macro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import {
  approveTimesheetEntries,
  assertCanApprove,
  getTimesheetApprovals,
  rejectTimesheetEntries
} from "~/modules/projects";
import { postTimesheetEntries } from "~/modules/projects/projects.server";
import TimesheetApprovals from "~/modules/projects/ui/Timesheet/TimesheetApprovals";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-timesheet-approvals");

export const handle: Handle = {
  breadcrumb: msg`Approvals`,
  to: path.to.projectTimesheetApprovals,
  module: "projects"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "projects"
  });

  // A projects_update holder approves time on every project.
  const approvals = await getTimesheetApprovals(client, companyId, {
    ownerId: null
  });
  if (approvals.error) {
    logger.error("Failed to load timesheet approvals", {
      companyId,
      error: approvals.error
    });
  }

  return { groups: approvals.data ?? [] };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "projects"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");
  const ids = formData
    .getAll("ids")
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (ids.length === 0) {
    return data(
      { success: false },
      await flash(request, error(null, "No entries were given"))
    );
  }

  if (intent === "approve") {
    // DCAA mode: a labor transfer needs an approver other than the
    // requester. Checked for every entry before any status changes.
    const refusal = await laborTransferRefusal(client, {
      companyId,
      approverId: userId,
      ids
    });
    if (refusal) {
      return data(
        { success: false },
        await flash(request, error(null, refusal))
      );
    }

    const approved = await approveTimesheetEntries(client, {
      ids,
      companyId,
      approvedBy: userId
    });
    if (approved.error) {
      logger.error("Failed to approve timesheet entries", {
        companyId,
        error: approved.error
      });
      return data(
        { success: false },
        await flash(
          request,
          error(approved.error, "Failed to approve the time")
        )
      );
    }

    const approvedIds = (approved.data ?? []).map((row) => row.id);
    const postingError = await postTimesheetEntries({
      timesheetEntryIds: approvedIds,
      companyId,
      userId
    });
    if (postingError) {
      return data(
        { success: false },
        await flash(
          request,
          error(null, `The time is approved but did not post: ${postingError}`)
        )
      );
    }

    return data(
      { success: true },
      await flash(request, success("Time approved and posted"))
    );
  }

  if (intent === "reject") {
    const note = String(formData.get("note") ?? "").trim();
    if (!note) {
      return data(
        { success: false },
        await flash(request, error(null, "A note is required to reject time"))
      );
    }
    const rejected = await rejectTimesheetEntries(client, {
      ids,
      companyId,
      note,
      updatedBy: userId
    });
    if (rejected.error) {
      logger.error("Failed to reject timesheet entries", {
        companyId,
        error: rejected.error
      });
      return data(
        { success: false },
        await flash(request, error(rejected.error, "Failed to reject the time"))
      );
    }
    return data(
      { success: true },
      await flash(request, success("Time rejected"))
    );
  }

  return data(
    { success: false },
    await flash(request, error(null, "Unknown action"))
  );
}

/**
 * The refusal of `assertCanApprove` for the first entry the approver may not
 * approve, else null. A transfer's reversal counts as part of the transfer:
 * its original is the entry a replacement corrects (`correctionOfId`).
 */
async function laborTransferRefusal(
  client: SupabaseClient<Database>,
  args: { companyId: string; approverId: string; ids: string[] }
): Promise<string | null> {
  const [settings, entries] = await Promise.all([
    client
      .from("companySettings")
      .select("timekeepingControls")
      .eq("id", args.companyId)
      .single(),
    client
      .from("timesheetEntry")
      .select("id, correctionOfId, reversalOfId, createdBy")
      .eq("companyId", args.companyId)
      .in("id", args.ids)
  ]);
  if (settings.error || entries.error) {
    logger.error("Failed to load the entries to approve", {
      companyId: args.companyId,
      error: settings.error ?? entries.error
    });
    return "Failed to load the entries to approve";
  }
  const mode = settings.data.timekeepingControls;
  if (mode !== "DCAA") return null;

  const reversedIds = entries.data.flatMap((entry) =>
    entry.reversalOfId ? [entry.reversalOfId] : []
  );
  let transferredIds = new Set<string>();
  if (reversedIds.length > 0) {
    const replacements = await client
      .from("timesheetEntry")
      .select("correctionOfId")
      .eq("companyId", args.companyId)
      .in("correctionOfId", reversedIds);
    if (replacements.error) {
      logger.error("Failed to load the labor transfers", {
        companyId: args.companyId,
        error: replacements.error
      });
      return "Failed to load the entries to approve";
    }
    transferredIds = new Set(
      replacements.data.flatMap((row) =>
        row.correctionOfId ? [row.correctionOfId] : []
      )
    );
  }

  for (const entry of entries.data) {
    const correctionOfId =
      entry.correctionOfId ??
      (entry.reversalOfId && transferredIds.has(entry.reversalOfId)
        ? entry.reversalOfId
        : null);
    try {
      assertCanApprove({
        mode,
        approverId: args.approverId,
        entry: { correctionOfId, createdBy: entry.createdBy }
      });
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }
  return null;
}

export default function ProjectTimesheetApprovalsRoute() {
  const { groups } = useLoaderData<typeof loader>();
  return <TimesheetApprovals groups={groups} />;
}
