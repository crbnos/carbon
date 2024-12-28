import { useParams } from "@remix-run/react";
import { DetailSidebar } from "~/components/Layout";
import { useRouteData } from "~/hooks";
import type { ReceiptLine } from "~/modules/inventory";
import type { Note } from "~/modules/shared";
import { path } from "~/utils/path";
import { useReceiptSidebar } from "./useReceiptSidebar";

const ReceiptSidebar = () => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const routeData = useRouteData<{
    receiptLines: ReceiptLine[];
    notes: Note[];
  }>(path.to.receipt(receiptId));

  const links = useReceiptSidebar(routeData?.receiptLines, routeData?.notes);

  return <DetailSidebar links={links} />;
};

export default ReceiptSidebar;
