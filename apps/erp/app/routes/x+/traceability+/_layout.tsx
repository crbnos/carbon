import { Outlet } from "@remix-run/react";
import type { MetaFunction } from "@vercel/remix";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Traceability" }];
};

export const handle: Handle = {
  breadcrumb: "Inventory",
  to: path.to.inventory,
  module: "inventory",
};

export default function TraceabilityLayout() {
  return <Outlet />;
}
