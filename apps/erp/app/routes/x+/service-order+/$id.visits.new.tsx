// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { serviceVisitValidator } from "~/modules/service/service.models";
import ScheduleVisitModal from "~/modules/service/ui/Visits/ScheduleVisitModal";
import { path } from "~/utils/path";

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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(serviceVisitValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  if (input.data.serviceOrderId !== id) {
    return validationError({
      fieldErrors: { technicianId: "The visit is not for this service order" }
    });
  }

  const api = await carbon(args.request);
  const result = await api.service.scheduleServiceVisit(input.data);
  if (result.error?.category === "rule") {
    return validationError({
      fieldErrors: { technicianId: result.error.message }
    });
  }
  return respond(args.request, result).redirect(
    path.to.serviceOrderVisits(id),
    {
      message: input.data.id ? "Visit rescheduled" : "Visit scheduled"
    }
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
