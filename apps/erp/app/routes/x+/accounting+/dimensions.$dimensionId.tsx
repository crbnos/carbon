// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import {
  dimensionValidator,
  getDimension,
  upsertDimension
} from "~/modules/accounting";
import { DimensionForm } from "~/modules/accounting/ui/Dimensions";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { dimensionId } = params;
  if (!dimensionId) throw notFound("dimensionId not found");

  const dimension = await getDimension(client, dimensionId);

  return {
    dimension: dimension?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(dimensionValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, dimensionValues, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateDimension = await upsertDimension(
    client,
    {
      id,
      ...d,
      updatedBy: userId
    },
    dimensionValues
  );

  if (updateDimension.error) {
    return data(
      {},
      await flash(
        request,
        error(updateDimension.error, "Failed to update dimension")
      )
    );
  }

  throw redirect(
    `${path.to.dimensions}?${getParams(request)}`,
    await flash(request, success("Updated dimension"))
  );
}

export default function EditDimensionRoute() {
  const { dimension } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  const initialValues = {
    id: dimension?.id ?? undefined,
    name: dimension?.name ?? "",
    entityType: dimension?.entityType ?? ("Custom" as const),
    active: dimension?.active ?? true,
    required: dimension?.required ?? false,
    dimensionValues:
      dimension?.dimensionValue?.map((v: { name: string }) => v.name) ?? []
  };

  return (
    <DimensionForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => closeRoute()}
    />
  );
}
