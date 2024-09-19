import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { MetaFunction } from "@vercel/remix";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Invoicing" }];
};

export const handle: Handle = {
  breadcrumb: "Invoicing",
  to: path.to.purchaseInvoices,
  module: "invoicing",
};

export default function PurchaseInvoiceRoute() {
  return (
    <VStack spacing={4} className="h-full p-2">
      <Outlet />
    </VStack>
  );
}
