import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { enrollTotpFactor, getTotpFactors } from "@carbon/auth/mfa.server";
import { requireAuthSession } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCompany } from "~/modules/settings";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {});
  const authSession = await requireAuthSession(request);

  // GoTrue requires factor friendly names to be unique per user.
  const verifiedCount = (await getTotpFactors(authSession.userId)).filter(
    (f) => f.status === "verified"
  ).length;
  const friendlyName =
    verifiedCount === 0
      ? "Authenticator app"
      : `Authenticator app ${verifiedCount + 1}`;

  // The authenticator app shows `issuer` above the account (the user's email),
  // so naming the company here is what distinguishes two Carbon tenants in a
  // phone's list — otherwise both read "Carbon" and neither can be told apart.
  const company = await getCompany(client, companyId);
  const issuer = company.data?.name
    ? `Carbon (${company.data.name})`
    : "Carbon";

  const enrollment = await enrollTotpFactor(
    {
      accessToken: authSession.accessToken,
      refreshToken: authSession.refreshToken
    },
    friendlyName,
    issuer
  );

  if (!enrollment) {
    return data(error(null, "Failed to start enrollment"), { status: 500 });
  }

  return enrollment;
}
