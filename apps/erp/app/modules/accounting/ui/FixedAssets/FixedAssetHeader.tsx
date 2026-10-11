// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MENU_ITEM_SHORTCUTS,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCircleArrowUp,
  LuCircleCheck,
  LuCircleX,
  LuClipboardCheck,
  LuCoins,
  LuLink,
  LuPackageCheck,
  LuPencil,
  LuShoppingCart,
  LuStore,
  LuTrash,
  LuWrench
} from "react-icons/lu";
import { useFetcher, useNavigate, useParams } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { DocumentPageHeader } from "~/components/DocumentPage";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData } from "~/hooks";
import type { FixedAsset } from "~/modules/accounting";
import { path } from "~/utils/path";
import FixedAssetStatus from "./FixedAssetStatus";

const FixedAssetHeader = () => {
  const { t } = useLingui();
  const { fixedAssetId } = useParams();
  if (!fixedAssetId) throw new Error("fixedAssetId not found");

  const routeData = useRouteData<{
    asset: FixedAsset;
    isCipClass: boolean;
  }>(path.to.fixedAsset(fixedAssetId));

  const permissions = usePermissions();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const deleteModal = useDisclosure();

  const asset = routeData?.asset;
  if (!asset) throw new Error("Could not find asset in routeData");
  const isCipClass = routeData?.isCipClass ?? false;

  const isDraft = asset.status === "Draft";
  const isActive =
    asset.status === "Active" || asset.status === "Fully Depreciated";
  const isUnderConstruction = asset.status === "Under Construction";
  const isOutOfService = Boolean(asset.outOfServiceSince);
  const canUpdate = permissions.can("update", "accounting");
  const canCreate = permissions.can("create", "accounting");
  // A CIP asset takes cost from attached jobs until it is capitalized into
  // its in-service class; both actions only make sense on a CIP class.
  const canAttachJob = isCipClass && (isDraft || isUnderConstruction);
  const canCapitalizeCip = isCipClass && isUnderConstruction;
  const canReturnToInventory = Boolean(asset.itemId) && isActive;

  // The one next step: register a draft, capitalize a build, bring an asset
  // back into service, else sell it.
  const primary: "register" | "capitalize" | "returnToService" | "sell" | null =
    isDraft
      ? "register"
      : canCapitalizeCip
        ? "capitalize"
        : isOutOfService
          ? "returnToService"
          : isActive
            ? "sell"
            : null;

  const isReturningToService = fetcher.state !== "idle";
  const returnToService = () =>
    fetcher.submit(
      {},
      {
        method: "post",
        action: `${path.to.fixedAssetOutOfService(fixedAssetId)}?intent=return`
      }
    );

  return (
    <>
      <DocumentPageHeader
        title={asset.fixedAssetId}
        status={<FixedAssetStatus status={asset.status} />}
        meta={[
          <Trans key="created">
            Created <DateTime value={asset.createdAt} variant="relative" /> by{" "}
            <EmployeeAvatar employeeId={asset.createdBy} />
          </Trans>,
          asset.acquisitionDate ? (
            <Trans key="acquired">
              Acquired <DateTime value={asset.acquisitionDate} variant="date" />
            </Trans>
          ) : null,
          asset.outOfServiceSince ? (
            <Trans key="out-of-service">
              Out of service since{" "}
              <DateTime value={asset.outOfServiceSince} variant="date" />
            </Trans>
          ) : null,
          asset.disposalDate ? (
            <Trans key="disposed">
              Disposed <DateTime value={asset.disposalDate} variant="date" />
            </Trans>
          ) : null
        ]}
        menuItems={
          <>
            <DropdownMenuItem
              shortcut={MENU_ITEM_SHORTCUTS.edit}
              disabled={!canUpdate}
              onClick={() => navigate(path.to.fixedAssetDetails(fixedAssetId))}
            >
              <DropdownMenuIcon icon={<LuPencil />} />
              <Trans>Edit</Trans>
            </DropdownMenuItem>
            {isActive && !isOutOfService && (
              <DropdownMenuItem
                disabled={!canUpdate}
                onClick={() =>
                  navigate(path.to.fixedAssetOutOfService(fixedAssetId))
                }
              >
                <DropdownMenuIcon icon={<LuWrench />} />
                <Trans>Take Out of Service</Trans>
              </DropdownMenuItem>
            )}
            {isActive && (
              <DropdownMenuItem
                disabled={!canUpdate}
                onClick={() =>
                  navigate(path.to.fixedAssetAdjustCost(fixedAssetId))
                }
              >
                <DropdownMenuIcon icon={<LuCoins />} />
                <Trans>Adjust Cost</Trans>
              </DropdownMenuItem>
            )}
            {canReturnToInventory && (
              <DropdownMenuItem
                disabled={!canCreate}
                onClick={() =>
                  navigate(path.to.fixedAssetReturnToInventory(fixedAssetId))
                }
              >
                <DropdownMenuIcon icon={<LuPackageCheck />} />
                <Trans>Return to Inventory</Trans>
              </DropdownMenuItem>
            )}
            {isDraft && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  shortcut={MENU_ITEM_SHORTCUTS.delete}
                  disabled={!permissions.can("delete", "accounting")}
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Fixed Asset</Trans>
                </DropdownMenuItem>
              </>
            )}
          </>
        }
        actions={
          <>
            {/* A CIP asset collects purchased cost while Under Construction. */}
            {(isDraft || isUnderConstruction) && (
              <Button
                variant="secondary"
                leftIcon={<LuShoppingCart />}
                onClick={() =>
                  navigate(path.to.fixedAssetPurchase(fixedAssetId))
                }
              >
                <Trans>Purchase</Trans>
              </Button>
            )}
            {canAttachJob && (
              <Button
                variant="secondary"
                leftIcon={<LuLink />}
                isDisabled={!canCreate}
                onClick={() =>
                  navigate(path.to.fixedAssetAttachJob(fixedAssetId))
                }
              >
                <Trans>Attach Job</Trans>
              </Button>
            )}
            {isActive && (
              <Button
                variant="secondary"
                leftIcon={<LuCircleX />}
                isDisabled={!canUpdate}
                onClick={() =>
                  navigate(path.to.fixedAssetDispose(fixedAssetId))
                }
              >
                <Trans>Dispose</Trans>
              </Button>
            )}
            {isActive && (
              <Button
                variant={primary === "sell" ? "primary" : "secondary"}
                leftIcon={<LuStore />}
                onClick={() => navigate(path.to.fixedAssetSell(fixedAssetId))}
              >
                <Trans>Sell</Trans>
              </Button>
            )}
            {isOutOfService && (
              <Button
                variant={
                  primary === "returnToService" ? "primary" : "secondary"
                }
                leftIcon={<LuCircleCheck />}
                isDisabled={!canUpdate}
                isLoading={isReturningToService}
                onClick={returnToService}
              >
                <Trans>Return to Service</Trans>
              </Button>
            )}
            {canCapitalizeCip && (
              <Button
                variant={primary === "capitalize" ? "primary" : "secondary"}
                leftIcon={<LuCircleArrowUp />}
                isDisabled={!canCreate}
                onClick={() =>
                  navigate(path.to.fixedAssetCapitalizeCip(fixedAssetId))
                }
              >
                <Trans>Capitalize</Trans>
              </Button>
            )}
            {isDraft && (
              <Button
                variant={primary === "register" ? "primary" : "secondary"}
                leftIcon={<LuClipboardCheck />}
                isDisabled={!canUpdate}
                onClick={() =>
                  navigate(path.to.fixedAssetRegister(fixedAssetId))
                }
              >
                <Trans>Register</Trans>
              </Button>
            )}
          </>
        }
      />

      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteFixedAsset(fixedAssetId)}
          isOpen={deleteModal.isOpen}
          name={asset.fixedAssetId}
          text={t`Are you sure you want to delete ${asset.fixedAssetId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={() => {
            deleteModal.onClose();
            navigate(path.to.fixedAssets);
          }}
        />
      )}
    </>
  );
};

export default FixedAssetHeader;
