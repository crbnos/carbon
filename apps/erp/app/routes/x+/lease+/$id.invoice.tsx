// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { datetime, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  generateLeaseInvoicesNow,
  getLease
} from "~/modules/purchasing/purchasing.service";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  // Drafts purchase invoices, so the invoicing permission is required too.
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing",
    create: "invoicing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const lease = await getLease(client, id, companyId);
  if (lease.error || !lease.data) {
    throw redirect(
      path.to.leases,
      await flash(
        request,
        error(lease.error, "Lease not found", { leaseId: id })
      )
    );
  }
  if (lease.data.status === "Draft" || lease.data.status === "Cancelled") {
    throw redirect(
      requestReferrer(request) ?? path.to.leaseDetails(id),
      await flash(request, error(null, "Activate the lease to invoice it"))
    );
  }

  const timeZone = await getCompanyTimeZone(client, companyId);

  let invoiceIds: string[];
  try {
    ({ invoiceIds } = await generateLeaseInvoicesNow(getDatabaseClient(), {
      companyId,
      asOf: datetime.today(timeZone).toString(),
      leaseId: id,
      userId
    }));
  } catch (err) {
    throw redirect(
      requestReferrer(request) ?? path.to.leaseDetails(id),
      await flash(
        request,
        error(err, "Failed to draft invoices", {
          leaseId: id
        })
      )
    );
  }

  if (invoiceIds.length === 0) {
    throw redirect(
      requestReferrer(request) ?? path.to.leaseDetails(id),
      await flash(request, success("No lease payment is due yet"))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.leaseDetails(id),
    await flash(
      request,
      success(
        invoiceIds.length === 1
          ? "Drafted 1 lease invoice"
          : `Drafted ${invoiceIds.length} lease invoices`
      )
    )
  );
}
