import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getNonConformanceType,
  nonConformanceTypeValidator,
  upsertNonConformanceType,
} from "~/modules/quality";
import NonConformanceTypeForm from "~/modules/quality/ui/NonConformanceTypes/NonConformanceTypeForm";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const nonConformanceType = await getNonConformanceType(client, id);

  if (nonConformanceType.error) {
    throw redirect(
      path.to.nonConformanceTypes,
      await flash(
        request,
        error(nonConformanceType.error, "Failed to get non-conformance type")
      )
    );
  }

  return json({
    nonConformanceType: nonConformanceType.data,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "quality",
  });

  const formData = await request.formData();
  const validation = await validator(nonConformanceTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const updateNonConformanceType = await upsertNonConformanceType(client, {
    id,
    ...data,
    updatedBy: userId,
  });

  if (updateNonConformanceType.error) {
    return json(
      {},
      await flash(
        request,
        error(updateNonConformanceType.error, "Failed to update non-conformance type")
      )
    );
  }

  throw redirect(
    path.to.nonConformanceTypes,
    await flash(request, success("Updated non-conformance type"))
  );
}

export default function EditNonConformanceTypeRoute() {
  const { nonConformanceType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: nonConformanceType.id ?? undefined,
    name: nonConformanceType.name ?? "",
  };

  return (
    <NonConformanceTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
