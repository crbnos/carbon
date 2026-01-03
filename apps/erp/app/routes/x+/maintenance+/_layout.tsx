import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Maintenance" }];
};

export const handle: Handle = {
  breadcrumb: "Resources",
  to: path.to.resources,
  module: "resources"
};

export default function MaintenanceRoute() {
  return <Outlet />;
}
