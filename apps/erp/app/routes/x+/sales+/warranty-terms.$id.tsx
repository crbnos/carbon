import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getWarrantyTerm,
  warrantyTermValidator,
  upsertWarrantyTerm
} from "~/modules/sales";
import WarrantyTermForm from "~/modules/sales/ui/WarrantyTerms/WarrantyTermForm";

import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const warrantyTerm = await getWarrantyTerm(client, id, companyId);

  if (warrantyTerm.error) {
    throw redirect(
      path.to.warrantyTerms,
      await flash(
        request,
        error(warrantyTerm.error, "Failed to get warranty term")
      )
    );
  }

  return {
    warrantyTerm: warrantyTerm.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(warrantyTermValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateWarrantyTerm = await upsertWarrantyTerm(client, {
    id,
    companyId,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateWarrantyTerm.error) {
    return data(
      {},
      await flash(
        request,
        error(updateWarrantyTerm.error, "Failed to update warranty term")
      )
    );
  }

  throw redirect(
    path.to.warrantyTerms,
    await flash(request, success("Updated warranty term"))
  );
}

export default function EditWarrantyTermRoute() {
  const { warrantyTerm } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: warrantyTerm.id ?? undefined,
    name: warrantyTerm.name ?? "",
    coversParts: warrantyTerm.coversParts ?? true,
    partsDurationMonths: warrantyTerm.partsDurationMonths ?? undefined,
    coversLabor: warrantyTerm.coversLabor ?? true,
    laborDurationMonths: warrantyTerm.laborDurationMonths ?? undefined,
    startBasis: warrantyTerm.startBasis ?? "Ship Date",
    ...getCustomFields(warrantyTerm.customFields)
  };

  return (
    <WarrantyTermForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
