import { redirect, type ActionFunctionArgs } from "@remix-run/node";
import { getCompanies } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import {
  destroyAuthSession,
  flash,
  updateCompanySession,
} from "~/services/session.server";
import { path, requestReferrer } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});
  const companies = await getCompanies(client, userId);

  if (companies.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.authenticatedRoot,
      await flash(request, error(companies.error, "Failed to get companies"))
    );
  }

  const companyId = params.companyId;
  if (!companies.data?.find((company) => company.id === companyId)) {
    throw redirect(
      requestReferrer(request) ?? path.to.authenticatedRoot,
      await flash(request, error(null, "Company not found"))
    );
  }

  if (!companyId) {
    await destroyAuthSession(request);
  }

  throw redirect(requestReferrer(request) ?? path.to.authenticatedRoot, {
    headers: {
      "Set-Cookie": await updateCompanySession(request, companyId!),
    },
  });
}
