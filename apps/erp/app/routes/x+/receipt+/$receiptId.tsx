import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { PanelProvider } from "~/components/Layout";
import {
  ReceiptHeader,
  getReceipt,
  getReceiptFiles,
  getReceiptLines,
} from "~/modules/inventory";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Receipts",
  to: path.to.receipts,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "inventory",
  });

  const serviceRole = await getCarbonServiceRole();

  const { receiptId } = params;
  if (!receiptId) throw new Error("Could not find receiptId");

  const [receipt, receiptLines] = await Promise.all([
    getReceipt(serviceRole, receiptId),
    getReceiptLines(serviceRole, receiptId),
  ]);

  if (receipt.error) {
    throw redirect(
      path.to.receipts,
      await flash(request, error(receipt.error, "Failed to load receipt"))
    );
  }

  if (receipt.data.companyId !== companyId) {
    throw redirect(path.to.receipts);
  }

  let receiptLineIds: string[] = [];

  if (receiptLines.data) {
    receiptLineIds = receiptLines.data.map((line) => line.id);
  }

  return defer({
    receipt: receipt.data,
    receiptLines: receiptLines.data ?? [],
    receiptFiles: getReceiptFiles(serviceRole, companyId, receiptLineIds) ?? [],
  });
}

export default function ReceiptRoute() {
  const params = useParams();
  const { receiptId } = params;
  if (!receiptId) throw new Error("Could not find receiptId");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <ReceiptHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-y-auto scrollbar-hide w-full">
          <VStack
            spacing={4}
            className="h-full p-2 w-full max-w-5xl mx-auto pb-32"
          >
            <Outlet />
          </VStack>
        </div>
      </div>
    </PanelProvider>
  );
}
