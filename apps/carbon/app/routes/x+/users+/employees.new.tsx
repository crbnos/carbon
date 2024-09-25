import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  CreateEmployeeModal,
  createEmployeeValidator,
  getInvitable,
} from "~/modules/users";
import { createEmployeeAccount } from "~/modules/users/users.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "users",
  });

  const invitable = await getInvitable(client, companyId);
  if (invitable.error) {
    throw redirect(
      path.to.employeeAccounts,
      await flash(
        request,
        error(invitable.error, "Failed to load invitable users")
      )
    );
  }

  return json({
    invitable: invitable.data ?? [],
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "users",
  });

  const validation = await validator(createEmployeeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { email, firstName, lastName, locationId, employeeType } =
    validation.data;
  const result = await createEmployeeAccount(client, {
    email,
    firstName,
    lastName,
    employeeType,
    locationId,
    companyId,
  });

  throw redirect(path.to.employeeAccounts, await flash(request, result));
}

export default function () {
  const { invitable } = useLoaderData<typeof loader>();

  return <CreateEmployeeModal invitable={invitable} />;
}
