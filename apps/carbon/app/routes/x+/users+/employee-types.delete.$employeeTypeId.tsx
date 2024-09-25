import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteEmployeeType, getEmployeeType } from "~/modules/users";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "users",
    role: "employee",
  });
  const { employeeTypeId } = params;
  if (!employeeTypeId) throw notFound("EmployeeTypeId not found");

  const employeeType = await getEmployeeType(client, employeeTypeId);
  if (employeeType.error) {
    throw redirect(
      path.to.employeeTypes,
      await flash(
        request,
        error(employeeType.error, "Failed to get employee type")
      )
    );
  }

  return json({
    employeeType: employeeType.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "users",
  });

  const { employeeTypeId } = params;
  if (!employeeTypeId) {
    throw redirect(
      path.to.employeeTypes,
      await flash(request, error(params, "Failed to get an employee type id"))
    );
  }

  const { error: deleteTypeError } = await deleteEmployeeType(
    client,
    employeeTypeId
  );
  if (deleteTypeError) {
    throw redirect(
      path.to.employeeTypes,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete employee type")
      )
    );
  }

  // TODO - delete employeeType group

  throw redirect(
    path.to.employeeTypes,
    await flash(request, success("Successfully deleted employee type"))
  );
}

export default function DeleteEmployeeTypeRoute() {
  const { employeeTypeId } = useParams();
  const { employeeType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!employeeType) return null;
  if (!employeeTypeId) throw new Error("employeeTypeId is not found");

  const onCancel = () => navigate(path.to.employeeTypes);

  return (
    <ConfirmDelete
      action={path.to.deleteEmployeeType(employeeTypeId)}
      name={employeeType.name}
      text={`Are you sure you want to delete the employee type: ${employeeType.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
