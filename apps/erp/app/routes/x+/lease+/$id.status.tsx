// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { serverFns } from "@carbon/server-functions";
import { getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getLease } from "~/modules/purchasing";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  if (formData.get("intent") !== "cancel") {
    throw redirect(
      path.to.leaseDetails(id),
      await flash(request, error(null, "Invalid status change"))
    );
  }

  const lease = await getLease(client, id, companyId);
  if (lease.error || lease.data?.companyId !== companyId) {
    throw redirect(
      path.to.leases,
      await flash(request, error(lease.error, "Lease not found"))
    );
  }
  // The server function owns the guards: a Draft is refused (it is deleted
  // through the delete route, which needs `delete: purchasing`), and an
  // Active lease needs no invoiced payment and no posted lease run.
  const result = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("post-lease", { type: "cancel", leaseId: id });

  if (result.error) {
    throw redirect(
      path.to.leaseDetails(id),
      await flash(
        request,
        error(
          result.error,
          getErrorMessage(result.error, "Failed to cancel lease")
        )
      )
    );
  }

  throw redirect(
    path.to.leaseDetails(id),
    await flash(request, success("Lease cancelled"))
  );
}
