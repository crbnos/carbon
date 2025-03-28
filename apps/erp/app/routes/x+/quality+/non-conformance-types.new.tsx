import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { nonConformanceTypeValidator, upsertNonConformanceType } from "~/modules/quality";
import NonConformanceTypeForm from "~/modules/quality/ui/NonConformanceTypes/NonConformanceTypeForm";
import { getParams, path, requestReferrer } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "quality",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(nonConformanceTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertNonConformanceType = await upsertNonConformanceType(client, {
    ...data,
    companyId,
    createdBy: userId,
  });
  if (insertNonConformanceType.error) {
    return modal
      ? json(insertNonConformanceType)
      : redirect(
          requestReferrer(request) ??
            `${path.to.nonConformanceTypes}?${getParams(request)}`,
          await flash(
            request,
            error(insertNonConformanceType.error, "Failed to insert non-conformance type")
          )
        );
  }

  return modal
    ? json(insertNonConformanceType)
    : redirect(
        `${path.to.nonConformanceTypes}?${getParams(request)}`,
        await flash(request, success("Non-conformance type created"))
      );
}

export default function NewCustomerStatusesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
  };

  return (
    <NonConformanceTypeForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
