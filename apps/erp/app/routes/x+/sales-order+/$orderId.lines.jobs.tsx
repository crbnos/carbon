// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { convertSalesOrderLinesToJobs } from "~/modules/production/production.service";
import { getSalesOrder } from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    create: "production"
  });

  const { orderId } = params;
  if (!orderId) {
    throw new Error("Invalid orderId");
  }

  const { companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const salesOrder = await getSalesOrder(client, orderId);
  if (salesOrder.error) {
    throw redirect(
      path.to.salesOrder(orderId),
      await flash(request, error(salesOrder.error, "Failed to get sales order"))
    );
  }

  const serviceRole = getCarbonServiceRole();

  const convertedJobs = await convertSalesOrderLinesToJobs(
    serviceRole,
    getDatabaseClient(),
    {
      orderId,
      companyId,
      userId
    }
  );

  if (convertedJobs.error) {
    const errorObj = convertedJobs.error as any;
    const errorMessage =
      typeof errorObj === "string"
        ? errorObj
        : errorObj?.details || errorObj?.message || "Unknown error";

    throw redirect(
      path.to.salesOrder(orderId),
      await flash(
        request,
        error(
          convertedJobs.error,
          `Failed to convert sales order lines to jobs: ${errorMessage}`
        )
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.salesOrder(orderId),
    await flash(request, success("Jobs created"))
  );
}
