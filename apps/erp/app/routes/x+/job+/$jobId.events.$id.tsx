// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { productionEventValidator } from "~/modules/production/production.models";
import {
  getJobOperations,
  getProductionEvent
} from "~/modules/production/production.service";
import { ProductionEventForm } from "~/modules/production/ui/Jobs";
import { getWorkCentersList } from "~/modules/resources/resources.service";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "production"
  });

  const { id, jobId } = params;
  if (!id) throw notFound("id not found");
  if (!jobId) throw notFound("jobId not found");

  const [jobOperations, workCenters, productionEvent] = await Promise.all([
    getJobOperations(client, jobId),
    getWorkCentersList(client, companyId),
    getProductionEvent(client, id)
  ]);

  const operationOptions = jobOperations.data?.map((operation) => ({
    label: `${operation.description} - ${
      workCenters.data?.find((center) => center.id === operation.workCenterId)
        ?.name
    }`,
    value: operation.id,
    processId: operation.processId
  }));

  if (productionEvent.error) {
    throw notFound("Failed to fetch production event");
  }

  return { productionEvent: productionEvent.data, operationOptions };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(productionEventValidator).request(args, {
    params: ["jobId", "id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.production.updateProductionEvent({
    ...input.data,
    id: input.params.id
  });
  const postingError = result.data?.postingError;
  return respond(
    args.request,
    postingError
      ? {
          error: {
            message: `Production event updated, but no journal entry was posted: ${postingError}`
          }
        }
      : result
  ).redirect(
    result.error
      ? `${new URL(args.request.url).pathname}?${getParams(args.request)}`
      : `${path.to.jobProductionEvents(input.params.jobId)}?${getParams(args.request)}`,
    { message: "Updated production event" }
  );
}

export default function EditProductionEventRoute() {
  const { productionEvent, operationOptions } = useLoaderData<typeof loader>();

  const initialValues = {
    id: productionEvent?.id!,
    type: productionEvent?.type ?? ("Setup" as "Setup"),
    jobOperationId: productionEvent?.jobOperationId ?? "",
    startTime: productionEvent?.startTime ?? "",
    employeeId: productionEvent?.employeeId ?? "",
    workCenterId: productionEvent?.workCenterId ?? "",
    endTime: productionEvent?.endTime ?? "",
    notes: productionEvent?.notes ?? ""
  };

  return (
    <ProductionEventForm
      key={initialValues.id}
      initialValues={initialValues}
      operationOptions={operationOptions ?? []}
    />
  );
}
