// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ProfileForm } from "@carbon/account/ui";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getScimOwnedFields } from "@carbon/ee/scim.server";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useUser } from "~/hooks";
import { getAccount } from "~/modules/users/users.service";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const [account, scimOwned] = await Promise.all([
    getAccount(client, personId),
    getScimOwnedFields(getCarbonServiceRole(), companyId, personId)
  ]);

  if (account.error) {
    throw redirect(
      path.to.people,
      await flash(request, error(account.error, "Failed to load account"))
    );
  }

  return {
    user: account.data,
    // A failed read only leaves the name editable; the save still checks.
    isNameSetByIdentityProvider: scimOwned.data.name
  };
}

export default function PersonProfileRoute() {
  const { user, isNameSetByIdentityProvider } = useLoaderData<typeof loader>();
  const { company } = useUser();

  return (
    <ProfileForm
      user={user}
      action={path.to.person(user.id)}
      photo={{ action: path.to.api.accountProfile, companyId: company.id }}
      isNameSetByIdentityProvider={isNameSetByIdentityProvider}
    />
  );
}
