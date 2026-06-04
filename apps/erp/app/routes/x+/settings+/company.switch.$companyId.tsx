import { error, safeRedirect } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { setCompanyId } from "@carbon/auth/company.server";
import {
  destroyAuthSession,
  flash,
  updateCompanySession
} from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getCompanies } from "~/modules/settings";
import { path, requestReferrer } from "~/utils/path";

export async function loader() {
  throw redirect(path.to.authenticatedRoot);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const redirectTo = formData.get("redirectTo");

  const companies = await getCompanies(client, userId);

  if (companies.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.authenticatedRoot,
      await flash(request, error(companies.error, "Failed to get companies"))
    );
  }

  const companyId = params.companyId;
  const matchedCompany = companies.data?.find(
    (company) => company.id === companyId
  );
  if (!matchedCompany) {
    throw redirect(
      requestReferrer(request) ?? path.to.authenticatedRoot,
      await flash(request, error(null, "Company not found"))
    );
  }

  if (!companyId) {
    await destroyAuthSession(request);
  }

  const sessionCookie = await updateCompanySession(
    request,
    companyId!,
    matchedCompany.companyGroupId ?? ""
  );
  const companyIdCookie = setCompanyId(companyId!);

  throw redirect(
    safeRedirect(
      typeof redirectTo === "string" ? redirectTo : null,
      path.to.authenticatedRoot
    ),
    {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie]
      ]
    }
  );
}
