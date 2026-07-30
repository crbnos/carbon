import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteEmployeeType, getEmployeeType } from "~/modules/users";
import { path } from "~/utils/path";
import { getCompanyId, invalidateUserSelectQueries } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "users",
    role: "employee"
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

  return {
    employeeType: employeeType.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "users"
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

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  invalidateUserSelectQueries(getCompanyId());
  return await serverAction();
}

export default function DeleteEmployeeTypeRoute() {
  const { employeeTypeId } = useParams();
  const { employeeType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!employeeType) return null;
  if (!employeeTypeId) throw new Error("employeeTypeId is not found");

  const onCancel = () => navigate(path.to.employeeTypes);

  return (
    <ConfirmDelete
      action={path.to.deleteEmployeeType(employeeTypeId)}
      name={employeeType.name}
      text={t`Are you sure you want to delete the employee type: ${employeeType.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
