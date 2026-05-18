import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getAccount } from "~/modules/account";
import { ProfileForm } from "~/modules/account/ui/Profile";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const account = await getAccount(personId);
  if (account.error) {
    throw redirect(
      path.to.people,
      await flash(request, error(account.error, "Failed to load account"))
    );
  }

  return {
    user: account.data
  };
}

export default function PersonProfileRoute() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Profile</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ProfileForm user={user} />
      </CardContent>
    </Card>
  );
}
