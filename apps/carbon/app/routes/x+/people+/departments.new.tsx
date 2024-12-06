import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { departmentValidator, upsertDepartment } from "~/modules/people";
import { DepartmentForm } from "~/modules/people/ui/Departments";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "people",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(departmentValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createDepartment = await upsertDepartment(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createDepartment.error) {
    return modal
      ? json(
          createDepartment,
          await flash(
            request,
            error(createDepartment.error, "Failed to insert department")
          )
        )
      : redirect(
          path.to.departments,
          await flash(
            request,
            error(createDepartment.error, "Failed to create department.")
          )
        );
  }

  return modal
    ? json(createDepartment, { status: 201 })
    : redirect(
        path.to.departments,
        await flash(request, success("Department created"))
      );
}

export default function NewDepartmentRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
  };

  return (
    <DepartmentForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
