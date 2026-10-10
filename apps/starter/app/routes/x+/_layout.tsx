// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { AccountSettings } from "@carbon/account/ui";
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
import { setClientCompanyId } from "@carbon/query/cache";
import { Toaster, useNProgress } from "@carbon/react";
import { redirectExternal } from "@carbon/utils";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { path } from "~/utils/path";

// The refreshed session reaches the client through this loader, and the
// refresh asks for no other loader to re-run.
export const shouldRevalidate: ShouldRevalidateFunction = ({
  formAction,
  defaultShouldRevalidate
}) => formAction === path.to.refreshSession || defaultShouldRevalidate;

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
    throw redirectExternal(getAppUrl());
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
  const { session, company, user } = useLoaderData<typeof loader>();
  // During render, not in an effect: the cached API reads key on the company.
  setClientCompanyId(company?.id ?? null, user?.id ?? null);

  useNProgress();

  return (
    <CarbonProvider session={session}>
      <Outlet />
      {user && company?.id && (
        <AccountSettings
          api={path.to.erpApi}
          user={user}
          companyId={company.id}
        />
      )}
      <Toaster position="bottom-right" />
    </CarbonProvider>
  );
}
