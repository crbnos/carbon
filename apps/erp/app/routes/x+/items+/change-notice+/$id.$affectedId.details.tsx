import { VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { ChangeNotice } from "~/modules/items";
import { canEditChangeNoticeEngineering } from "~/modules/items";
import type { AffectedItemDraft } from "~/modules/items/ui/ChangeNotice";
import AffectedItemDetail from "~/modules/items/ui/ChangeNotice/AffectedItemDetail";
import { path } from "~/utils/path";

// The selected affected item's line detail, addressed by the URL (not client
// state) — mirrors the sales order line route `$orderId.$lineId.details`. Its
// data comes from the parent $id loader (useRouteData); the URL only decides
// which affected item to show, so refresh + back/forward reselect it.
export default function ChangeNoticeAffectedItemRoute() {
  const { id, affectedId } = useParams();
  const { t } = useLingui();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    changeNotice: ChangeNotice;
    affectedItems: AffectedItemDraft[];
  }>(path.to.changeNotice(id));

  const changeNotice = routeData?.changeNotice;
  if (!changeNotice) throw new Error("Could not find change notice data");

  const affected =
    routeData?.affectedItems.find((a) => a.affectedItem.id === affectedId) ??
    null;

  if (!affected) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <Trans>Affected item not found.</Trans>
      </div>
    );
  }

  const isDisabled = !canEditChangeNoticeEngineering(changeNotice.status);
  // UI copy is kept separate from the server guard's flash text (same split as
  // ReleaseLockAlert) — React macros can't run server-side, so this is the
  // translated half of the same condition.
  const disabledReason =
    changeNotice.status === "Implementation"
      ? t`This change notice is being implemented, so its changes are locked. Reopen it to edit.`
      : t`This change notice is closed, so its changes are read-only.`;

  return (
    <VStack spacing={2} className="p-2">
      <AffectedItemDetail
        key={affected.affectedItem.id}
        changeOrderId={id}
        affected={affected}
        isDisabled={isDisabled}
        disabledReason={disabledReason}
      />
    </VStack>
  );
}
