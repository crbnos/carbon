// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requireAuthSession } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  // GoTrue sends a refused sign-in (SAML SSO, OAuth) back to its site URL —
  // this route — with the reason in the query. Hand the code to the login
  // page, which says what went wrong; without it the user landed there with
  // no message at all. Some failures carry only `error` (a GoTrue
  // server_error has no error_code); the login page reads any code it does
  // not know as a generic failure.
  const params = new URL(request.url).searchParams;
  const authErrorCode = params.get("error_code") ?? params.get("error");
  if (authErrorCode) {
    throw redirect(
      `${path.to.login}?error=${encodeURIComponent(authErrorCode)}`
    );
  }

  await requireAuthSession(request);
  throw redirect(path.to.authenticatedRoot);
}

export default function IndexRoute() {
  return (
    <p>
      Oops. You shouldn't see this page. Eventually it will be a landing page.
    </p>
  );
}
