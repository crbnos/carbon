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
import { getJobOperations } from "~/modules/production/production.service";
import { ProductionEventForm } from "~/modules/production/ui/Jobs";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    create: "production"
  });

  const { jobId } = params;
  if (!jobId) throw notFound("jobId not found");

  const jobOperations = await getJobOperations(client, jobId);

  const operationOptions =
    jobOperations.data?.map((operation) => ({
      label: operation.description ?? "",
      value: operation.id,
      processId: operation.processId
    })) ?? [];

  return { operationOptions };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(productionEventValidator).request(args, {
    params: ["jobId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.production.createProductionEvent(input.data);
  const postingError = result.data?.postingError;
  return respond(
    args.request,
    postingError
      ? {
          error: {
            message: `Production event created, but no journal entry was posted: ${postingError}`
          }
        }
      : result
  ).redirect(
    result.error
      ? `${new URL(args.request.url).pathname}?${getParams(args.request)}`
      : `${path.to.jobProductionEvents(input.params.jobId)}?${getParams(args.request)}`,
    { message: "Production event created" }
  );
}

export default function NewProductionEventRoute() {
  const { operationOptions } = useLoaderData<typeof loader>();
  const initialValues = {
    type: "Labor" as const,
    jobOperationId: "",
    startTime: new Date(new Date().setHours(8, 0, 0, 0)).toISOString(),
    employeeId: "",
    workCenterId: "",
    notes: ""
  };

  return (
    <ProductionEventForm
      initialValues={initialValues}
      operationOptions={operationOptions ?? []}
    />
  );
}
