import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getReturnReason,
  returnReasonValidator,
  upsertReturnReason
} from "~/modules/sales";
import ReturnReasonForm from "~/modules/sales/ui/ReturnReasons/ReturnReasonForm";

import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const returnReason = await getReturnReason(client, id);

  if (returnReason.error) {
    throw redirect(
      path.to.returnReasons,
      await flash(
        request,
        error(returnReason.error, "Failed to get return reason")
      )
    );
  }

  return {
    returnReason: returnReason.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(returnReasonValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateReturnReason = await upsertReturnReason(client, {
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateReturnReason.error) {
    return data(
      {},
      await flash(
        request,
        error(updateReturnReason.error, "Failed to update return reason")
      )
    );
  }

  throw redirect(
    path.to.returnReasons,
    await flash(request, success("Updated return reason"))
  );
}

export default function EditReturnReasonRoute() {
  const { returnReason } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: returnReason.id ?? undefined,
    name: returnReason.name ?? "",
    inventoryValueZero: returnReason.inventoryValueZero ?? false,
    ...getCustomFields(returnReason.customFields)
  };

  return (
    <ReturnReasonForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
