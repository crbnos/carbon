// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { serviceVisitValidator } from "~/modules/service/service.models";
import {
  ServiceOrderError,
  scheduleServiceVisit
} from "~/modules/service/service.server";
import ScheduleVisitModal from "~/modules/service/ui/Visits/ScheduleVisitModal";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "service-visit-schedule");

/** `?visitId=` opens a scheduled visit to move it; else a new visit. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const visitId = new URL(request.url).searchParams.get("visitId");
  if (!visitId) return { visit: null };

  const visit = await client
    .from("serviceVisit")
    .select("id, technicianId, plannedStart, plannedEnd")
    .eq("id", visitId)
    .eq("serviceOrderId", id)
    .eq("companyId", companyId)
    .maybeSingle();
  return { visit: visit.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const validation = await validator(serviceVisitValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);
  if (validation.data.serviceOrderId !== id) {
    return validationError({
      fieldErrors: { technicianId: "The visit is not for this service order" }
    });
  }

  try {
    await scheduleServiceVisit(getDatabaseClient(), {
      ...validation.data,
      companyId,
      userId
    });
  } catch (err) {
    if (err instanceof ServiceOrderError) {
      return validationError({ fieldErrors: { technicianId: err.message } });
    }
    logger.error("Failed to schedule the visit", {
      companyId,
      serviceOrderId: id,
      error: err
    });
    throw redirect(
      path.to.serviceOrderVisits(id),
      await flash(request, error(err, "Failed to schedule the visit"))
    );
  }

  throw redirect(
    path.to.serviceOrderVisits(id),
    await flash(
      request,
      success(validation.data.id ? "Visit rescheduled" : "Visit scheduled")
    )
  );
}

export default function ScheduleVisitRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const { visit } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <ScheduleVisitModal
      initialValues={{
        id: visit?.id,
        serviceOrderId: id,
        technicianId: visit?.technicianId ?? "",
        plannedStart: visit?.plannedStart ?? undefined,
        plannedEnd: visit?.plannedEnd ?? undefined
      }}
      onClose={() => navigate(path.to.serviceOrderVisits(id))}
    />
  );
}
