import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import { warrantyTermValidator, upsertWarrantyTerm } from "~/modules/sales";
import WarrantyTermForm from "~/modules/sales/ui/WarrantyTerms/WarrantyTermForm";

import { setCustomFields } from "~/utils/form";
import { getParams, path, requestReferrer } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "sales",
    role: "employee"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
    role: "employee"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(warrantyTermValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is stripped for insert
  const { id, ...d } = validation.data;

  const insertWarrantyTerm = await upsertWarrantyTerm(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertWarrantyTerm.error) {
    return modal
      ? insertWarrantyTerm
      : redirect(
          requestReferrer(request) ??
            `${path.to.warrantyTerms}?${getParams(request)}`,
          await flash(
            request,
            error(insertWarrantyTerm.error, "Failed to insert warranty term")
          )
        );
  }

  return modal
    ? insertWarrantyTerm
    : redirect(
        `${path.to.warrantyTerms}?${getParams(request)}`,
        await flash(request, success("Warranty term created"))
      );
}

export default function NewWarrantyTermRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    coversParts: true,
    partsDurationMonths: 12,
    coversLabor: true,
    laborDurationMonths: 12,
    startBasis: "Ship Date" as const
  };

  return (
    <WarrantyTermForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
