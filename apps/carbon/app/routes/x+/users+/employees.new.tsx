import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  CreateEmployeeModal,
  createEmployeeValidator,
  getInvitable,
} from "~/modules/users";
import { createEmployeeAccount } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

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

  const { email, firstName, lastName, employeeType } = validation.data;
  const result = await createEmployeeAccount(client, {
    email,
    firstName,
    lastName,
    employeeType,
    companyId,
  });

  throw redirect(path.to.employeeAccounts, await flash(request, result));
}

export default function () {
  const { invitable } = useLoaderData<typeof loader>();

  return <CreateEmployeeModal invitable={invitable} />;
}
