import type { MetaFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Sales Orders" }];
};

export const handle: Handle = {
  breadcrumb: "Sales",
  to: path.to.salesOrders,
  module: "sales",
};

export default function SalesOrderRoute() {
  return <Outlet />;
}
