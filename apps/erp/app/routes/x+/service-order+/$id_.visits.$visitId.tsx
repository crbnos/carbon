// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, hasPermission } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getUserClaims } from "@carbon/auth/users.server";
import type { Json } from "@carbon/database";
import { storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { usePermissions, useUser } from "~/hooks";
import { getLaborCategoriesList } from "~/modules/projects";
import {
  getCustomerAssetRecentOrders,
  getServiceNodeLastServiceDates,
  getServiceVisit,
  getServiceWork,
  updateServiceVisit
} from "~/modules/service";
import {
  requireOwnServiceVisit,
  ServiceOrderError
} from "~/modules/service/service.server";
import VisitPage from "~/modules/service/ui/Visits/VisitPage";
import { getDatabaseClient } from "~/services/database.server";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

const logger = getLogger("erp", "service-visit");

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`My Visits`, to: path.to.myVisits },
    (data) => data?.visit?.serviceOrder?.serviceOrderId
  ),
  module: "service"
};

/** The file the signature route writes, kept out of the photos. */
const SIGNATURE_FILE = "signature.png";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "service"
  });
  const { id, visitId } = params;
  if (!id) throw new Error("Could not find id");
  if (!visitId) throw new Error("Could not find visitId");

  const visit = await getServiceVisit(client, visitId, companyId);
  if (visit.error || visit.data.serviceOrderId !== id) {
    throw redirect(
      path.to.myVisits,
      await flash(request, error(visit.error, "Failed to load the visit"))
    );
  }
  const order = visit.data.serviceOrder;

  const [work, recentOrders, laborCategories, employeeJob, files] =
    await Promise.all([
      getServiceWork(client, order.projectId, companyId),
      order.customerAssetId
        ? getCustomerAssetRecentOrders(client, {
            customerAssetId: order.customerAssetId,
            companyId,
            excludeServiceOrderId: order.id,
            limit: 3
          })
        : null,
      getLaborCategoriesList(client, companyId),
      client
        .from("employeeJob")
        .select("laborCategoryId")
        .eq("id", userId)
        .eq("companyId", companyId)
        .maybeSingle(),
      storage(client)
        .company(companyId)
        .list(`${companyId}/service/${id}/${visitId}`)
    ]);
  if (work.error) {
    logger.error("Failed to load the work tree of a visit", {
      companyId,
      serviceVisitId: visitId,
      error: work.error
    });
  }

  const lastServiceDates = await getServiceNodeLastServiceDates(
    client,
    work.elements,
    companyId
  );
  if (lastServiceDates.error) {
    logger.error("Failed to load the last service dates", {
      companyId,
      serviceVisitId: visitId,
      error: lastServiceDates.error
    });
  }

  return {
    visit: visit.data,
    nodes: work.elements,
    lastServiceDates: lastServiceDates.data ?? {},
    recentOrders: recentOrders?.data ?? [],
    photos: (files.data ?? [])
      .filter((file) => file.id !== null && file.name !== SIGNATURE_FILE)
      .map((file) => ({
        name: file.name,
        path: `${companyId}/service/${id}/${visitId}/${file.name}`
      })),
    laborCategories: laborCategories.data ?? [],
    defaultLaborCategoryId: employeeJob.data?.laborCategoryId ?? null
  };
}

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

/**
 * Saves the visit's notes (`intent=field`, `field=notes`). A user without
 * `update: "service"` saves only their own open visit.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "service"
  });
  const { id, visitId } = params;
  if (!id) throw new Error("Could not find id");
  if (!visitId) throw new Error("Could not find visitId");

  const formData = await request.formData();
  if (formData.get("intent") !== "field" || formData.get("field") !== "notes") {
    return failure("Unknown field");
  }
  let notes: Json;
  try {
    const value = formData.get("value");
    notes = JSON.parse(typeof value === "string" ? value : "{}");
  } catch {
    return failure("Invalid text");
  }

  const canUpdateAny = hasPermission(
    (await getUserClaims(userId, companyId))?.permissions,
    "service",
    "update",
    companyId
  );
  if (!canUpdateAny) {
    try {
      await requireOwnServiceVisit(getDatabaseClient(), {
        companyId,
        serviceOrderId: id,
        serviceVisitId: visitId,
        userId
      });
    } catch (err) {
      if (err instanceof ServiceOrderError) return failure(err.message);
      throw err;
    }
  }

  const update = await updateServiceVisit(client, {
    id: visitId,
    serviceOrderId: id,
    companyId,
    updatedBy: userId,
    notes
  });
  if (update.error) {
    logger.error("Failed to save the visit notes", {
      companyId,
      serviceVisitId: visitId,
      error: update.error
    });
    return failure("Failed to save the notes");
  }
  return { success: true };
}

export default function ServiceVisitRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const user = useUser();
  const canUpdateAny = permissions.can("update", "service");
  const isOwn = loaderData.visit.technicianId === user.id;

  return (
    <VisitPage
      key={loaderData.visit.id}
      {...loaderData}
      mayWork={canUpdateAny || isOwn}
      mayMove={canUpdateAny || isOwn}
      canIssue={permissions.can("update", "inventory")}
    />
  );
}
