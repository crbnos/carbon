// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { setCompanyId } from "@carbon/auth/company.server";
import {
  refreshAuthSession,
  setAuthSession
} from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";

import { path } from "~/utils/path";

export async function loader() {
  throw redirect(path.to.root);
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const authSession = await refreshAuthSession(request);

  const sessionCookie = await setAuthSession(request, {
    authSession
  });
  const companyIdCookie = setCompanyId(authSession.companyId);

  return data(
    { success: true },
    {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie]
      ]
    }
  );
}

export function ErrorBoundary() {
  const navigate = useNavigate();
  navigate(path.to.root);
  return null;
}
