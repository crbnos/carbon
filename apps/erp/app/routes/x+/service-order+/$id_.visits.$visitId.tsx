// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { storage } from "@carbon/files";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { usePermissions, useUser } from "~/hooks";
import { getLaborCategoriesList } from "~/modules/projects/projects.service";
import {
  getCustomerAssetRecentOrders,
  getServiceNodeLastServiceDates,
  getServiceVisit,
  getServiceWork
} from "~/modules/service/service.service";
import VisitPage from "~/modules/service/ui/Visits/VisitPage";
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
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args, {
    params: ["id", "visitId"]
  });
  if ("invalid" in input) return input.invalid;
  const formData = await args.request.formData();
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

  const api = await carbon(args.request);
  const result = await api.service.updateServiceVisitNotes({
    serviceOrderId: input.params.id,
    serviceVisitId: input.params.visitId,
    notes
  });
  if (result.error) return failure(result.error.message);
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
