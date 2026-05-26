import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { setCompanyId } from "@carbon/auth/company.server";
import {
  destroyAuthSession,
  flash,
  updateCompanySession
} from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getCompanies } from "~/modules/settings/settings.service.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {});
  const companies = await getCompanies();

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

  throw redirect(path.to.authenticatedRoot, {
    headers: [
      ["Set-Cookie", sessionCookie],
      ["Set-Cookie", companyIdCookie]
    ]
  });
}
