// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { cancelPendingApprovals } from "@carbon/ee/approvals/document.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteChangeNotice } from "~/modules/items";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "change-notice-delete");

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("id is not found");

  const mutation = await deleteChangeNotice(
    client,
    getDatabaseClient(),
    id,
    companyId
  );
  if (mutation.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(mutation.error, "Failed to delete change notice")
      )
    );
  }

  // approvalRequest.documentId has no FK, so the request would outlive the
  // notice in approvers' lists.
  const cancelled = await cancelPendingApprovals(getCarbonServiceRole(), {
    documentType: "changeOrder",
    documentIds: [id],
    companyId,
    userId
  });
  if (cancelled.error) {
    logger.error("Failed to cancel change notice approval requests", {
      companyId,
      changeNoticeId: id,
      error: cancelled.error
    });
  }

  throw redirect(
    path.to.changeNotices,
    await flash(request, success("Successfully deleted change notice"))
  );
}
