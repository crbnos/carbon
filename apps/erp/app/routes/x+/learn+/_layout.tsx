import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => [{ title: "Carbon | Learn" }];

/**
 * Learn has no module sidebar of its own: the hub IS the navigation, and the
 * unit and exam runners want the full width. `module: "resources"` keeps the
 * breadcrumb and nav highlighting consistent with Training, which this extends.
 */
export const handle: Handle = {
  breadcrumb: msg`Learn`,
  to: path.to.learn,
  module: "resources"
};

export default function LearnLayout() {
  return <Outlet />;
}
