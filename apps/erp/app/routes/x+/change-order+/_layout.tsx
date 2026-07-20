import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Change Order" }];
};

export const handle: Handle = {
  breadcrumb: msg`Items`,
  to: path.to.items,
  module: "items"
};

export default function ChangeOrderRoute() {
  return <Outlet />;
}
