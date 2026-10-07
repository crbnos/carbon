// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { serverFns } from "@carbon/server-functions";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getInventoryCount } from "~/modules/inventory";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

// Post (Pending -> Posted): atomically posts the variance as inventory
// adjustments.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const header = await getInventoryCount(client, id, companyId);
  if (header.data?.status !== "Pending") {
    // Fetcher submit — return data so the component toasts it (see below).
    return data(
      {
        success: false,
        message: "Only a confirmed (pending) count can be made effective"
      },
      { status: 400 }
    );
  }

  const post = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-inventory-count", { inventoryCountId: id });

  if (post.error) {
    // The Post button submits via a fetcher, so a redirect+flash toast is not
    // reliably surfaced. Return the error as fetcher data (with the real message
    // and, for line-level validation errors like snapshot drift or serial-qty,
    // the `invalidLineIds`) so the component can toast it and highlight the
    // offending rows; the fetcher still revalidates, so the count stays Pending
    // and re-renders.
    const message = post.error.message || "Failed to post inventory count";
    const invalidLineIds = Array.isArray(post.error.body.invalidLineIds)
      ? (post.error.body.invalidLineIds as string[])
      : undefined;
    return data({ success: false, message, invalidLineIds }, { status: 400 });
  }

  throw redirect(
    path.to.inventoryCount(id),
    await flash(request, success("Inventory count posted"))
  );
}
