// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  CarbonProvider,
  getAppUrl,
  getCarbon,
  getCompanies,
  getUser
} from "@carbon/auth";
import {
  destroyAuthSession,
  requireAuthSession
} from "@carbon/auth/session.server";
import { Toaster, useNProgress } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { accessToken, companyId, expiresAt, expiresIn, userId } =
    await requireAuthSession(request, { verify: true });

  // share a client between requests
  const client = getCarbon(accessToken);

  // parallelize the requests
  const [companies, user] = await Promise.all([
    getCompanies(client, userId),
    getUser(client, userId)
  ]);

  if (user.error || !user.data) {
    await destroyAuthSession(request);
  }

  const company = companies.data?.find((c) => c.companyId === companyId);
  if (!company) {
    throw redirect(getAppUrl());
  }

  return {
    session: {
      accessToken,
      expiresIn,
      expiresAt
    },
    company,
    companies: companies.data ?? [],
    user: user.data
  };
}

export default function AuthenticatedRoute() {
  const { session } = useLoaderData<typeof loader>();

  useNProgress();

  return (
    <CarbonProvider session={session}>
      <Outlet />
      <Toaster position="bottom-right" />
    </CarbonProvider>
  );
}
