import { Outlet } from "@remix-run/react";
import { PurchaseOrderLines } from "~/modules/purchasing/ui/PurchaseOrder";

export default function PurchaseOrderLinesRoute() {
  return (
    <div className="flex flex-col w-full space-x-4 space-y-4">
      <PurchaseOrderLines />
      <Outlet />
    </div>
  );
}
