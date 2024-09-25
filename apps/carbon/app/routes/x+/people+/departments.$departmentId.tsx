import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  DepartmentForm,
  departmentValidator,
  getDepartment,
  upsertDepartment,
} from "~/modules/people";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people",
  });

  const { departmentId } = params;
  if (!departmentId) throw notFound("Department ID was not found");

  const department = await getDepartment(client, departmentId);

  if (department.error) {
    throw redirect(
      path.to.departments,
      await flash(request, error(department.error, "Failed to get department"))
    );
  }

  return json({
    department: department.data,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "people",
  });

  const formData = await request.formData();
  const validation = await validator(departmentValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw notFound("Department ID was not found");

  const updateDepartment = await upsertDepartment(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateDepartment.error) {
    throw redirect(
      path.to.departments,
      await flash(
        request,
        error(updateDepartment.error, "Failed to create department.")
      )
    );
  }

  throw redirect(
    path.to.departments,
    await flash(request, success("Department updated"))
  );
}

export default function DepartmentRoute() {
  const { department } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: department.id,
    name: department.name,
    parentDepartmentId: department.parentDepartmentId ?? undefined,
    ...getCustomFields(department.customFields),
  };

  return (
    <DepartmentForm
      onClose={() => navigate(-1)}
      key={initialValues.id}
      initialValues={initialValues}
    />
  );
}
