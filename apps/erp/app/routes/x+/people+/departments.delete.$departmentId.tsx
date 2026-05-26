import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteDepartment,
  getDepartment
} from "~/modules/people/people.service.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people",
    role: "employee"
  });

  const { departmentId } = params;
  if (!departmentId) throw notFound("departmentId not found");

  const department = await getDepartment(departmentId);
  if (department.error) {
    throw redirect(
      path.to.departments,
      await flash(request, error(department.error, "Failed to get department"))
    );
  }

  return {
    department: department.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "people"
  });

  const { departmentId } = params;
  if (!departmentId) {
    throw redirect(
      path.to.departments,
      await flash(request, error(params, "Failed to get department id"))
    );
  }

  const { error: deleteDepartmentError } = await deleteDepartment(departmentId);
  if (deleteDepartmentError) {
    throw redirect(
      path.to.departments,
      await flash(
        request,
        error(deleteDepartmentError, "Failed to delete department")
      )
    );
  }

  throw redirect(
    path.to.departments,
    await flash(request, success("Successfully deleted department"))
  );
}

export default function DeleteDepartmentRoute() {
  const { departmentId } = useParams();
  const { department } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!department) return null;
  if (!departmentId) throw new Error("departmentId is not found");

  const onCancel = () => navigate(path.to.departments);
  const name = department.name;
  return (
    <ConfirmDelete
      action={path.to.deleteDepartment(departmentId)}
      name={name}
      text={t`Are you sure you want to delete the department: ${name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
