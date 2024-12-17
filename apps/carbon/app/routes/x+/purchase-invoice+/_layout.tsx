import { Outlet } from "@remix-run/react";
import type { MetaFunction } from "@vercel/remix";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Invoicing" }];
};

export const handle: Handle = {
  breadcrumb: "Purchasing",
  to: path.to.purchasing,
  module: "purchasing",
};

export default function PurchaseInvoiceRoute() {
  return <Outlet />;
}
