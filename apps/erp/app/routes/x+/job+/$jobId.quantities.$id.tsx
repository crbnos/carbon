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
import {
  getJobOperations,
  getProductionQuantity
} from "~/modules/production/production.service";
import { ProductionQuantityForm } from "~/modules/production/ui/Jobs";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production"
  });

  const { id, jobId } = params;
  if (!id) throw notFound("id not found");
  if (!jobId) throw notFound("jobId not found");

  const [productionQuantity, jobOperations] = await Promise.all([
    getProductionQuantity(client, id),
    getJobOperations(client, jobId)
  ]);

  const operationOptions =
    jobOperations.data?.map((operation) => ({
      label: operation.description ?? "",
      value: operation.id
    })) ?? [];

  return {
    productionQuantity: productionQuantity?.data ?? null,
    operationOptions
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(productionQuantityValidator).request(args, {
    params: ["jobId", "id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.production.updateProductionQuantity({
    ...input.data,
    id: input.params.id
  });
  return respond(args.request, result).redirect(
    `${path.to.jobProductionQuantities(input.params.jobId)}?${getParams(args.request)}`,
    {
      message: "Updated production quantity",
      onError: `${new URL(args.request.url).pathname}?${getParams(args.request)}`
    }
  );
}

export default function EditProductionQuantityRoute() {
  const { productionQuantity, operationOptions } =
    useLoaderData<typeof loader>();

  const initialValues = {
    id: productionQuantity?.id!,
    type: productionQuantity?.type ?? ("Scrap" as "Scrap"),
    jobOperationId: productionQuantity?.jobOperationId ?? "",
    quantity: productionQuantity?.quantity ?? 0,
    scrapReasonId: productionQuantity?.scrapReasonId ?? "",
    notes: productionQuantity?.notes ?? "",
    createdBy: productionQuantity?.createdBy ?? ""
  };

  return (
    <ProductionQuantityForm
      key={initialValues.id}
      initialValues={initialValues}
      operationOptions={operationOptions ?? []}
    />
  );
}
