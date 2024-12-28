import { useParams } from "@remix-run/react";
import { LuFileText, LuList, LuStickyNote } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import type { ReceiptLine } from "~/modules/inventory/types";
import type { Note } from "~/modules/shared";
import type { Role } from "~/types";

export function useReceiptSidebar(
  lines: ReceiptLine[] = [],
  notes: Note[] = []
) {
  const permissions = usePermissions();
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  return [
    {
      name: "Details",
      to: "details",
      icon: <LuFileText />,
      shortcut: "Command+Shift+d",
    },
    {
      name: "Lines",
      to: "lines",
      role: ["employee"],
      count: lines.length,
      icon: <LuList />,
      shortcut: "Command+Shift+l",
    },

    {
      name: "Notes",
      to: "notes",
      role: ["employee"],
      count: notes.length,
      icon: <LuStickyNote />,
      shortcut: "Command+Shift+n",
    },
  ].filter(
    (item) =>
      item.role === undefined ||
      item.role.some((role) => permissions.is(role as Role))
  );
}
