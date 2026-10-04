// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getSalesOrderLine } from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "orderid-lineid-shipment");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { orderId, lineId } = params;
  if (!orderId || !lineId) {
    throw new Error("Invalid orderId or lineId");
  }

  const { companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const serviceRole = getCarbonServiceRole();
  const salesOrderLine = await getSalesOrderLine(serviceRole, lineId);

  if (salesOrderLine.error) {
    throw redirect(
      path.to.salesOrderLine(orderId, lineId),
      await flash(
        request,
        error(salesOrderLine.error, "Failed to get sales order line")
      )
    );
  }

  if (companyId !== salesOrderLine.data.companyId) {
    throw redirect(
      path.to.salesOrderLine(orderId, lineId),
      await flash(
        request,
        error("Company does not match", "Failed to get sales order line")
      )
    );
  }

  if (!salesOrderLine.data.locationId) {
    throw redirect(
      path.to.salesOrderLine(orderId, lineId),
      await flash(
        request,
        error(
          null,
          "Set a location on this sales order line before creating a shipment"
        )
      )
    );
  }

  const salesOrderShipment = await serverFns
    .system({ db: getDatabaseClient(), companyId, userId })
    .invoke("create", {
      type: "shipmentFromSalesOrderLine",
      locationId: salesOrderLine.data.locationId,
      salesOrderLineId: lineId
    });

  if (!salesOrderShipment.data || salesOrderShipment.error) {
    logger.error(salesOrderShipment.error);
    throw redirect(
      path.to.salesOrderLine(orderId, lineId),
      await flash(
        request,
        error(salesOrderShipment.error, "Failed to create shipment")
      )
    );
  }

  throw redirect(path.to.shipmentDetails(salesOrderShipment.data.id));
}
