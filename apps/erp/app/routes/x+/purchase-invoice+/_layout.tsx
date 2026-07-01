import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Invoicing" }];
};

export const handle: Handle = {
  breadcrumb: msg`Invoicing`,
  to: path.to.invoicing,
  module: "invoicing"
};

export default function PurchaseInvoiceRoute() {
  return <Outlet />;
}
