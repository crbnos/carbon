import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import {
  ReceiptHeader,
  ReceiptSidebar,
  getReceipt,
  getReceiptLines,
} from "~/modules/inventory";
import { getNotes } from "~/modules/shared";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory",
  });

  const { receiptId } = params;
  if (!receiptId) throw new Error("Could not find receiptId");

  const [receipt, receiptLines, notes] = await Promise.all([
    getReceipt(client, receiptId),
    getReceiptLines(client, receiptId),
    getNotes(client, receiptId),
  ]);

  if (receipt.error) {
    throw redirect(
      path.to.receipts,
      await flash(request, error(receipt.error, "Failed to load receipt"))
    );
  }

  return json({
    receipt: receipt.data,
    receiptLines: receiptLines.data ?? [],
    notes: notes.data ?? [],
  });
}

export default function ReceiptRoute() {
  return (
    <>
      <ReceiptHeader />
      <div className="grid grid-cols-1 md:grid-cols-[1fr_4fr] h-full w-full gap-4">
        <ReceiptSidebar />
        <Outlet />
      </div>
    </>
  );
}
