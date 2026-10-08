// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuBadgeDollarSign,
  LuCirclePlus,
  LuCircleSlash,
  LuEllipsisVertical,
  LuTrash,
  LuTruck,
  LuUndo2
} from "react-icons/lu";
import { useNavigate, useParams } from "react-router";
import { Empty, ItemThumbnail } from "~/components";
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import RentalAgreementLineForm from "./RentalAgreementLineForm";
import RentalStatus from "./RentalStatus";
import type { RentalAgreementLine, RentalAgreementRouteData } from "./types";
import {
  type RentalLineActionState,
  rentalUnitLabel,
  useRentalLineActions
} from "./useRentalLineActions";

/** The agreement's units, one row each, like a sales order's line items. */
export default function RentalAgreementExplorer() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(id)
  );
  const permissions = usePermissions();
  const addDisclosure = useDisclosure();

  const rentalAgreement = routeData?.rentalAgreement;
  const lines = routeData?.lines ?? [];
  const isDraft = rentalAgreement?.status === "Draft";
  const canAdd = isDraft && permissions.can("create", "sales");

  if (!rentalAgreement) return null;

  return (
    <>
      <VStack className="w-full h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] justify-between">
        <VStack
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          spacing={0}
        >
          {lines.length > 0 ? (
            <ExplorerLines
              rentalAgreement={rentalAgreement}
              lines={lines}
              agreementId={id}
            />
          ) : (
            <Empty>
              {isDraft && (
                <Button
                  isDisabled={!canAdd}
                  leftIcon={<LuCirclePlus />}
                  variant="secondary"
                  onClick={addDisclosure.onOpen}
                >
                  <Trans>Add Unit</Trans>
                </Button>
              )}
            </Empty>
          )}
        </VStack>
        {isDraft && (
          <div className="w-full flex border-t border-border p-4">
            <Button
              className="w-full"
              isDisabled={!canAdd}
              leftIcon={<LuCirclePlus />}
              variant="secondary"
              onClick={addDisclosure.onOpen}
            >
              <Trans>Add Unit</Trans>
            </Button>
          </div>
        )}
      </VStack>
      {addDisclosure.isOpen && (
        <RentalAgreementLineForm
          initialValues={{
            rentalAgreementId: id,
            fixedAssetId: "",
            rateUnit: "Month"
          }}
          customerId={rentalAgreement.customerId ?? ""}
          currencyCode={rentalAgreement.currencyCode ?? ""}
          startDate={rentalAgreement.startDate ?? ""}
          rentableAssets={routeData?.rentableAssets ?? []}
          closeOnSubmit
          onClose={addDisclosure.onClose}
        />
      )}
    </>
  );
}

function ExplorerLines({
  rentalAgreement,
  lines,
  agreementId
}: {
  rentalAgreement: RentalAgreementRouteData["rentalAgreement"];
  lines: RentalAgreementLine[];
  agreementId: string;
}) {
  const actions = useRentalLineActions(rentalAgreement);
  return (
    <>
      {lines.map((line) => (
        <ExplorerLine
          key={line.id}
          agreementId={agreementId}
          line={line}
          state={actions.stateOf(line)}
          onAction={actions.open}
        />
      ))}
      {actions.modals}
    </>
  );
}

function ExplorerLine({
  agreementId,
  line,
  state,
  onAction
}: {
  agreementId: string;
  line: RentalAgreementLine;
  state: RentalLineActionState;
  onAction: ReturnType<typeof useRentalLineActions>["open"];
}) {
  const { t } = useLingui();
  const location = useOptimisticLocation();
  const navigate = useNavigate();

  const to = path.to.rentalAgreementLine(agreementId, line.id);
  const isSelected = location.pathname === to;
  const hasActions =
    state.canDeliver ||
    state.canReturn ||
    state.canRelease ||
    state.canSell ||
    state.canDelete;

  return (
    <HStack
      className={cn(
        "group w-full p-2 items-center border-b hover:bg-accent/30 cursor-pointer relative",
        isSelected && "bg-accent/60 hover:bg-accent/50"
      )}
      onClick={() => {
        if (!isSelected) navigate(to);
      }}
    >
      <HStack spacing={2} className="flex-grow min-w-0 pr-10">
        <ItemThumbnail thumbnailPath={line.item?.thumbnailPath} type="Part" />
        <VStack spacing={0} className="min-w-0">
          <span className="font-semibold line-clamp-1">
            {line.fixedAsset?.fixedAssetId ?? rentalUnitLabel(line)}
          </span>
          <span className="text-muted-foreground text-xs truncate line-clamp-1">
            {[line.item?.readableIdWithRevision, line.fixedAsset?.serialNumber]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </VStack>
      </HStack>
      <HStack spacing={1} className="absolute right-2">
        <RentalStatus status={line.status} />
        {hasActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`Unit actions`}
                className="opacity-0 group-hover:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100"
                icon={<LuEllipsisVertical />}
                size="md"
                variant="solid"
                onClick={(e) => e.stopPropagation()}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
              {state.canDeliver && (
                <DropdownMenuItem
                  disabled={state.deliverDisabled}
                  onClick={() => onAction("deliver", line)}
                >
                  <DropdownMenuIcon icon={<LuTruck />} />
                  <Trans>Deliver</Trans>
                </DropdownMenuItem>
              )}
              {state.canReturn && (
                <DropdownMenuItem
                  disabled={state.returnDisabled}
                  onClick={() => onAction("return", line)}
                >
                  <DropdownMenuIcon icon={<LuUndo2 />} />
                  <Trans>Return</Trans>
                </DropdownMenuItem>
              )}
              {state.canRelease && (
                <DropdownMenuItem
                  disabled={state.releaseDisabled}
                  onClick={() => onAction("release", line)}
                >
                  <DropdownMenuIcon icon={<LuCircleSlash />} />
                  <Trans>Release unit</Trans>
                </DropdownMenuItem>
              )}
              {state.canSell && (
                <DropdownMenuItem
                  disabled={state.sellDisabled}
                  onClick={() => onAction("sell", line)}
                >
                  <DropdownMenuIcon icon={<LuBadgeDollarSign />} />
                  <Trans>Sell to Customer</Trans>
                </DropdownMenuItem>
              )}
              {state.canDelete && (
                <DropdownMenuItem
                  destructive
                  disabled={state.deleteDisabled}
                  onClick={() => onAction("delete", line)}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Unit</Trans>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </HStack>
    </HStack>
  );
}
