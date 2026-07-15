import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Outlet, redirect, useLoaderData } from "react-router";
import {
  accountProfileValidator,
  getAllAttributeCategories,
  updatePublicAccount
} from "~/modules/account";
import { getEmployeeSummary } from "~/modules/people";
import { PersonPreview, PersonSidebar } from "~/modules/people/ui/Person";
import { getCompanySettings } from "~/modules/settings";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`People`, to: path.to.people },
    (data) => data?.employeeSummary?.name
  )
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const [employeeSummary, attributeCategories, companySettings] =
    await Promise.all([
      getEmployeeSummary(client, personId, companyId),
      getAllAttributeCategories(client, personId, companyId),
      getCompanySettings(client, companyId)
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

  return {
    employeeSummary: employeeSummary.data,
    attributeCategories: attributeCategories.data ?? [],
    timeCardEnabled: companySettings.data?.timeCardEnabled ?? false
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "people"
  });
  const { personId } = params;
  if (!personId) throw new Error("No person ID provided");

  const validation = await validator(accountProfileValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { firstName, lastName, about, phone } = validation.data;

  const updateAccount = await updatePublicAccount(client, {
    id: personId,
    firstName,
    lastName,
    about,
    phone
  });
  if (updateAccount.error)
    return data(
      {},
      await flash(
        request,
        error(updateAccount.error, "Failed to update profile")
      )
    );

  return data({}, await flash(request, success("Updated profile")));
}

export default function PersonRoute() {
  const { attributeCategories, timeCardEnabled } =
    useLoaderData<typeof loader>();

  return (
    <>
      <PersonPreview />
      <div className="grid grid-cols-1 md:grid-cols-[1fr_4fr] h-full w-full gap-4">
        <PersonSidebar
          attributeCategories={attributeCategories}
          timeCardEnabled={timeCardEnabled}
        />
        <Outlet />
      </div>
    </>
  );
}
