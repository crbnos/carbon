import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Schedule" }];
};

export const handle: Handle = {
  breadcrumb: msg`Production`,
  to: path.to.production,
  module: "production"
};

export default function SchedulingRoute() {
  return <Outlet />;
}
