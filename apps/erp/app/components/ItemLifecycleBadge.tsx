import { Status } from "@carbon/react";
import { getItemLifecycleStatus } from "~/modules/items/ui/Item/ItemSupersessionForm";

// Small supersession lifecycle badge showing the item's supersession mode
// (Consume First / Prefer New / Stock Only / No Stock), reused wherever an item
// is selected or displayed. Renders nothing for parts with no supersession set.
export function ItemLifecycleBadge({
  mode
}: {
  mode: Parameters<typeof getItemLifecycleStatus>[0];
}) {
  const lifecycle = getItemLifecycleStatus(mode);
  if (!lifecycle) return null;
  return <Status color={lifecycle.color}>{lifecycle.label}</Status>;
}
