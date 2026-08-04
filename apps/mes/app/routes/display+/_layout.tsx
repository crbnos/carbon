import { CarbonProvider } from "@carbon/auth";
import { requireAuthSession } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs, MiddlewareFunction } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { userMiddleware } from "~/middleware/user";

/**
 * Layout for the wall-mounted work center displays.
 *
 * Deliberately a sibling of `x+` rather than a child: the `/x` layout renders
 * the sidebar, pin-in overlay, console pill and time-card warning, none of
 * which belong on a screen nobody touches. Reusing `userMiddleware` keeps the
 * same auth, company and location scoping without inheriting that chrome.
 *
 * `CarbonProvider` is the one piece of `/x` that IS load-bearing here. It is
 * the only thing in the app that renews the auth session — it polls each
 * minute and refreshes ten minutes before the access token expires. Without it
 * a display would authenticate once, run until the token lapsed roughly an
 * hour later, and then redirect to the login page and sit there. These screens
 * are meant to hang on a wall for months, so an hour of uptime is no uptime.
 */
export const middleware: MiddlewareFunction[] = [userMiddleware];

export async function loader({ request }: LoaderFunctionArgs) {
  // `verify: false` skips the `auth.getUser` round-trip on every load. The
  // display boards revalidate their own data every 30s, which re-runs this
  // loader too, so verifying here would hit the auth server once per screen per
  // tick for a board that hangs on the wall for months. `requireAuthSession`
  // still refreshes the token when it is expiring, and `CarbonProvider` (below)
  // renews it client-side — so the cheap revalidation keeps `expiresAt` fresh
  // and the session refreshes silently rather than reloading the page.
  const { accessToken, expiresAt, expiresIn } = await requireAuthSession(
    request,
    { verify: false }
  );

  return { session: { accessToken, expiresAt, expiresIn } };
}

export default function DisplayLayout() {
  const { session } = useLoaderData<typeof loader>();

  return (
    <CarbonProvider session={session}>
      <Outlet />
    </CarbonProvider>
  );
}
