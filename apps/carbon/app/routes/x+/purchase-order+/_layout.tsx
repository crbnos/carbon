import { Outlet } from "@remix-run/react";
import type { MetaFunction } from "@vercel/remix";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Purchase Order" }];
};

export const handle: Handle = {
  breadcrumb: "Purchasing",
  to: path.to.purchaseOrders,
  module: "purchasing",
};

export default function PurchaseOrderRoute() {
  return <Outlet />;
}
