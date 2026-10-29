// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, getCompanies } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { setCompanyId } from "@carbon/auth/company.server";
import {
  destroyAuthSession,
  flash,
  updateCompanySession
} from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    // Switching away from a portal company must work: a user can be an
    // employee of one company and a customer or supplier of another.
    allowPortalAccounts: true
  });
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

  throw redirect(path.to.authenticatedRoot, {
    headers: [
      ["Set-Cookie", sessionCookie],
      ["Set-Cookie", companyIdCookie]
    ]
  });
}
