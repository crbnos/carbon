import { assertIsPost } from "@carbon/auth";
import { setCompanyId } from "@carbon/auth/company.server";
import {
  refreshAuthSession,
  setAuthSession,
} from "@carbon/auth/session.server";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";

import { path } from "~/utils/path";

export async function loader() {
  throw redirect(path.to.authenticatedRoot);
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const authSession = await refreshAuthSession(request);

  const sessionCookie = await setAuthSession(request, {
    authSession,
  });
  const companyIdCookie = setCompanyId(authSession.companyId);

  return json(
    { success: true },
    {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie],
      ],
    }
  );
}

export function ErrorBoundary() {
  const navigate = useNavigate();
  navigate(path.to.authenticatedRoot);
  return null;
}
