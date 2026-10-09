// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import type { ServiceOrderStatusAction } from "~/modules/service";
import {
  canMoveServiceOrder,
  serviceOrderStatusActions
} from "~/modules/service";
import {
  cancelServiceOrder,
  ServiceOrderError,
  syncServiceOrderStatus
} from "~/modules/service/service.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "service-order-status");

const MESSAGES: Record<ServiceOrderStatusAction, string> = {
  "On Hold": "Put the service order on hold",
  Completed: "Completed the service order",
  Closed: "Closed the service order",
  Cancelled: "Cancelled the service order",
  Draft: "Reopened the service order"
};

/**
 * Moves an order to the status the user chose, then rolls its status up
 * from its visits and sets its work tree's status to match
 * (`syncServiceOrderStatus`). A cancel goes through `cancelServiceOrder`,
 * which refuses an order with posted charges.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "service"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");
  const back = requestReferrer(request) ?? path.to.serviceOrderDetails(id);

  const formData = await request.formData();
  const status = formData.get("status");
  if (
    typeof status !== "string" ||
    !(serviceOrderStatusActions as readonly string[]).includes(status)
  ) {
    throw redirect(back, await flash(request, error(null, "Invalid status")));
  }
  const to = status as ServiceOrderStatusAction;

  const current = await client
    .from("serviceOrder")
    .select("status")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (current.error) {
    throw redirect(
      back,
      await flash(request, error(current.error, "Failed to load service order"))
    );
  }
  if (!canMoveServiceOrder(current.data.status, to)) {
    throw redirect(
      back,
      await flash(
        request,
        error(null, `A ${current.data.status} service order cannot do that`)
      )
    );
  }

  try {
    if (to === "Cancelled") {
      await cancelServiceOrder(getDatabaseClient(), {
        companyId,
        serviceOrderId: id,
        userId
      });
    } else {
      await syncServiceOrderStatus(getDatabaseClient(), {
        companyId,
        serviceOrderId: id,
        userId,
        status: to
      });
    }
  } catch (err) {
    if (!(err instanceof ServiceOrderError)) {
      logger.error("Failed to move the service order", {
        companyId,
        serviceOrderId: id,
        status: to,
        error: err
      });
    }
    throw redirect(
      back,
      await flash(
        request,
        error(
          err,
          err instanceof ServiceOrderError
            ? err.message
            : "Failed to update the service order"
        )
      )
    );
  }

  throw redirect(back, await flash(request, success(MESSAGES[to])));
}
