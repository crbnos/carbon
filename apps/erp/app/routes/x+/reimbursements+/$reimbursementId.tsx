import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Reimbursements",
  to: path.to.reimbursements,
  module: "invoicing"
};

/**
 * The page FRAME, copied from `journal-entry+/$journalEntryId.tsx` — a plain
 * centered column. Deliberately NOT the purchase-invoice three-pane
 * PanelProvider/ResizablePanels shell: this document is one card and a line
 * list, not an explorer and a properties rail.
 *
 * Read mode lives in `$reimbursementId._index.tsx` and edit mode in
 * `$reimbursementId.edit.tsx`, so the two are siblings under this frame rather
 * than one route trying to be both.
 */
export default function ReimbursementRoute() {
  return (
    <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-y-auto scrollbar-hide w-full">
      <div className="h-full p-4 w-full max-w-5xl mx-auto">
        <Outlet />
      </div>
    </div>
  );
}
