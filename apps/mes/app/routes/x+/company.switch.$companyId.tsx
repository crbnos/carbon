import { error, getCompanies } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  destroyAuthSession,
  flash,
  updateCompanySession,
} from "@carbon/auth/session.server";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { getLocation, setLocation } from "~/services/location.server";
import { path, requestReferrer } from "~/utils/path";

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

  const sessionCookie = await updateCompanySession(request, companyId!);
  const storedLocations = await getLocation(request, client, {
    userId,
    companyId: companyId!,
  });

  if (storedLocations.updated) {
    const workCenterLocationCookie = await setLocation(
      companyId!,
      storedLocations.location
    );

    throw redirect(path.to.authenticatedRoot, {
      headers: {
        "Set-Cookie": `${sessionCookie} ${workCenterLocationCookie}`,
      },
    });
  }

  throw redirect(path.to.authenticatedRoot, {
    headers: {
      "Set-Cookie": sessionCookie,
    },
  });
}
