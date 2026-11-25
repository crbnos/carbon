// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, success } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { anyOf, ITEM_PAGES } from "@carbon/database/access";
import { getLogger } from "@carbon/logger";
import { getRequestOrigin, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "items");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { api, companyId } = await authorize(
    request,
    anyOf(ITEM_PAGES, "Edit")
  );

  const url = new URL(request.url);
  const methodToReplace = url.searchParams.get("methodToReplace");

  const { id } = params;
  if (!id) {
    logger.warning("Method version activation called without an id");
    return { success: false, message: "Invalid operation tool id" };
  }

  // Validate redirect inputs BEFORE mutating: activation switches the live
  // BOM/BOP, so a missing query param or referrer must fail without having
  // already flipped the method.
  if (!methodToReplace) {
    logger.warning("Method version activation missing methodToReplace", {
      methodVersionId: id
    });
    return {
      success: false,
      message: "Method to replace is required"
    };
  }

  const redirectPath = requestReferrer(request)?.replace(methodToReplace, id);

  if (!redirectPath) {
    // requestReferrer returns null when the Referer is missing or points at
    // another origin.
    logger.warning("Method version activation could not resolve a redirect", {
      methodVersionId: id,
      methodToReplace,
      referer: request.headers.get("referer"),
      requestUrl: request.url,
      origin: getRequestOrigin(request)
    });
    return {
      success: false,
      message: "Failed to redirect to the correct page"
    };
  }

  // The service function checks the revision lock and Edit on the page of
  // the method's item type.
  const update = await api.items.activateMethodVersion({ id });

  if (update.error) {
    logger.warning("Failed to activate method version", {
      methodVersionId: id,
      companyId,
      error: update.error
    });
    return {
      success: false,
      message: update.error.message || "Failed to activate method version"
    };
  }

  // Release control on warn: activated, with the lock's message (`withLockNotice`).
  const notice = "notice" in update.data ? String(update.data.notice) : null;
  return redirect(
    redirectPath,
    notice ? await flash(request, success(notice)) : undefined
  );
}
