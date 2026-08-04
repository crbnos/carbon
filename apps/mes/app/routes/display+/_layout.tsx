import type { MiddlewareFunction } from "react-router";
import { Outlet } from "react-router";
import { userMiddleware } from "~/middleware/user";

/**
 * Layout for the wall-mounted work center displays.
 *
 * Deliberately a sibling of `x+` rather than a child: the `/x` layout renders
 * the sidebar, pin-in overlay, console pill and time-card warning, none of
 * which belong on a screen nobody touches. Reusing `userMiddleware` keeps the
 * same auth, company and location scoping without inheriting that chrome.
 */
export const middleware: MiddlewareFunction[] = [userMiddleware];

export default function DisplayLayout() {
  return <Outlet />;
}
