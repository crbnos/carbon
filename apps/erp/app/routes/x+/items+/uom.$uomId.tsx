// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { unitOfMeasureValidator } from "~/modules/items/items.models";
import { upsertUnitOfMeasure } from "~/modules/items/items.service";
import { UnitOfMeasureForm } from "~/modules/items/ui/UnitOfMeasure";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "parts",
    role: "employee"
  });

  const { uomId } = params;
  if (!uomId) throw notFound("uomId not found");

  const unitOfMeasure = await api.items.getUnitOfMeasure({ id: uomId });

  return {
    unitOfMeasure: unitOfMeasure?.data ?? null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await authorize(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(unitOfMeasureValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw notFound("id not found");

  const updateUnitOfMeasure = await upsertUnitOfMeasure(client, {
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateUnitOfMeasure.error) {
    return data(
      {},
      await flash(
        request,
        error(updateUnitOfMeasure.error, "Failed to update unit of measure")
      )
    );
  }

  throw redirect(
    `${path.to.uoms}?${getParams(request)}`,
    await flash(request, success("Updated unit of measure"))
  );
}

export default function EditUnitOfMeasuresRoute() {
  const { unitOfMeasure } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  const initialValues = {
    id: unitOfMeasure?.id ?? undefined,
    name: unitOfMeasure?.name ?? "",
    code: unitOfMeasure?.code ?? "",
    ...getCustomFields(unitOfMeasure?.customFields)
  };

  return (
    <UnitOfMeasureForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => closeRoute()}
    />
  );
}
