// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "credits.post");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });
  const { memoId } = params;
  if (!memoId) {
    return { success: false, message: "Missing memoId" };
  }
  // `invoke` never throws: a refusal comes back as `result.error`, whose
  // message says why (empty for a data-layer failure, hence the fallback).
  const result = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-memo", { type: "post", memoId });
  if (result.error) {
    logger.error("memo post failed", {
      companyId,
      memoId,
      error: result.error
    });
    throw redirect(
      path.to.memo(memoId),
      await flash(
        request,
        error(result.error, result.error.message || "Failed to post memo")
      )
    );
  }

  throw redirect(
    path.to.memo(memoId),
    await flash(request, success("Memo posted"))
  );
}
