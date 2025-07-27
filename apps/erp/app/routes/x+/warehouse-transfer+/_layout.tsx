import { Outlet } from "@remix-run/react";
import type { MetaFunction } from "@vercel/remix";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Warehouse Transfer" }];
};

export const config = {
  runtime: "nodejs",
};

export const handle: Handle = {
  breadcrumb: "Inventory",
  to: path.to.inventory,
  module: "inventory",
};

export default function WarehouseTransferRoute() {
  return <Outlet />;
}
