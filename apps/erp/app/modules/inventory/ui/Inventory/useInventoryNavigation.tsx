import { useLingui } from "@lingui/react/macro";
import { LuChartBar, LuFileText } from "react-icons/lu";
import { useParams } from "react-router";
import { usePermissions } from "~/hooks";
import { DETAIL_TAB_SHORTCUTS } from "~/shortcuts";
import { path } from "~/utils/path";

export function useInventoryNavigation() {
  usePermissions();
  const { t } = useLingui();
  const { itemId } = useParams();
  if (!itemId) throw new Error("itemId not found");

  return [
    {
      name: t`Details`,
      to: path.to.inventoryItem(itemId),
      role: ["employee"],
      icon: LuFileText,
      shortcut: DETAIL_TAB_SHORTCUTS.details
    },
    {
      name: t`Activity`,
      to: path.to.inventoryItemActivity(itemId),
      role: ["employee"],
      icon: LuChartBar,
      shortcut: DETAIL_TAB_SHORTCUTS.activity
    }
  ];
}
