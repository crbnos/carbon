import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { path } from "~/utils/path";

import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { ProfileForm, getAccount } from "~/modules/account";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people",
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const account = await getAccount(client, personId);
  if (account.error) {
    throw redirect(
      path.to.people,
      await flash(request, error(account.error, "Failed to load account"))
    );
  }

  return json({
    user: account.data,
  });
}

export default function PersonProfileRoute() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <ProfileForm user={user} />
      </CardContent>
    </Card>
  );
}
