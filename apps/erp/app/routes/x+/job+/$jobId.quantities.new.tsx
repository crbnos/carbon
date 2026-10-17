// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { productionQuantityValidator } from "~/modules/production/production.models";
import { getJobOperations } from "~/modules/production/production.service";
import { ProductionQuantityForm } from "~/modules/production/ui/Jobs";
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
      value: operation.id
    })) ?? [];

  return { operationOptions };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(productionQuantityValidator).request(args, {
    params: ["jobId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.production.createProductionQuantity(input.data);
  return respond(args.request, result).redirect(
    `${path.to.jobProductionQuantities(input.params.jobId)}?${getParams(args.request)}`,
    {
      message: "Production quantity created",
      onError: `${new URL(args.request.url).pathname}?${getParams(args.request)}`
    }
  );
}

export default function NewProductionQuantityRoute() {
  const { operationOptions } = useLoaderData<typeof loader>();
  const initialValues = {
    type: "Production" as const,
    jobOperationId: "",
    quantity: 0,
    scrapReasonId: "",
    notes: "",
    createdBy: ""
  };

  return (
    <ProductionQuantityForm
      initialValues={initialValues}
      operationOptions={operationOptions ?? []}
    />
  );
}
