import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { Outlet } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  accountProfileValidator,
  updatePublicAccount,
} from "~/modules/account";
import {
  PersonPreview,
  PersonSidebar,
  getEmployeeSummary,
} from "~/modules/people";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "People",
  to: path.to.people,
};

export const config = {
  runtime: "nodejs",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people",
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const [employeeSummary] = await Promise.all([
    getEmployeeSummary(client, personId, companyId),
  ]);

  if (employeeSummary.error) {
    throw redirect(
      path.to.people,
      await flash(
        request,
        error(employeeSummary.error, "Failed to load employee summary")
      )
    );
  }

  return json({
    employeeSummary: employeeSummary.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "people",
  });
  const { personId } = params;
  if (!personId) throw new Error("No person ID provided");

  const validation = await validator(accountProfileValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { firstName, lastName, about } = validation.data;

  const updateAccount = await updatePublicAccount(client, {
    id: personId,
    firstName,
    lastName,
    about,
  });
  if (updateAccount.error)
    return json(
      {},
      await flash(
        request,
        error(updateAccount.error, "Failed to update profile")
      )
    );

  return json({}, await flash(request, success("Updated profile")));
}

export default function PersonRoute() {
  return (
    <>
      <PersonPreview />
      <div className="grid grid-cols-1 md:grid-cols-[1fr_4fr] h-full w-full gap-4">
        <PersonSidebar />
        <Outlet />
      </div>
    </>
  );
}
