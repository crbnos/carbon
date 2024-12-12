import { Outlet } from "@remix-run/react";
import { ReceiptLines } from "~/modules/inventory";

export default function ReceiptLinesRoute() {
  return (
    <div className="flex flex-col w-full space-x-4 space-y-4">
      <ReceiptLines />
      <Outlet />
    </div>
  );
}
