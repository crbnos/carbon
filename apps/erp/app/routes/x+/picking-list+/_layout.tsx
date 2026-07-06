import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Picking Lists" }];
};

export const handle: Handle = {
  breadcrumb: msg`Inventory`,
  to: path.to.inventory,
  module: "inventory"
};

export default function PickingListRoute() {
  return <Outlet />;
}
