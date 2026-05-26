import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useSearchParams } from "react-router";
import { departmentValidator } from "~/modules/people";
import { upsertDepartment } from "~/modules/people/people.service.server";
import { DepartmentForm } from "~/modules/people/ui/Departments";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "people"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(departmentValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const createDepartment = await upsertDepartment({
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createDepartment.error) {
    return modal
      ? data(
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
    ? data(createDepartment, { status: 201 })
    : redirect(
        path.to.departments,
        await flash(request, success("Department created"))
      );
}

export default function NewDepartmentRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const parentDepartmentId =
    searchParams.get("parentDepartmentId") ?? undefined;

  const initialValues = {
    name: "",
    parentDepartmentId
  };

  return (
    <DepartmentForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
