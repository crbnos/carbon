// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuCircleCheck,
  LuCircleStop,
  LuCreditCard,
  LuEllipsisVertical,
  LuPanelLeft,
  LuPencilLine,
  LuTrash,
  LuUndo2
} from "react-icons/lu";
import { Link } from "react-router";
import { usePanels } from "~/components/Layout";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { useCompanyToday, useDateFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import ContractAmendModal from "./ContractAmendModal";
import ContractCancelModal from "./ContractCancelModal";
import ContractStatus from "./ContractStatus";
import type { ContractRouteData } from "./types";

type ContractHeaderProps = Pick<ContractRouteData, "contract" | "lines">;

type PendingAction = "confirm" | "invoice" | "revert";

const ContractHeader = ({ contract, lines }: ContractHeaderProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { toggleExplorer } = usePanels();
  const { formatDate } = useDateFormatter();
  const today = useCompanyToday();

  const confirm = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const amendDisclosure = useDisclosure();
  const cancelDisclosure = useDisclosure();
  const [action, setAction] = useState<PendingAction | null>(null);

  const id = contract.id!;
  const readableId = contract.customerContractId ?? "";
  const status = contract.status;
  const canUpdate = permissions.can("update", "sales");

  const isDraft = status === "Draft";
  const isActive = status === "Active";
  const isCancelled = !!contract.cancelledAt;
  const hasLines = lines.length > 0;
  // A cancellation can be reverted until its end date has passed.
  const canRevertCancellation =
    isActive && isCancelled && !!contract.endDate && contract.endDate >= today;

  const open = (next: PendingAction) => {
    setAction(next);
    confirm.onOpen();
  };

  const confirmProps: Record<
    PendingAction,
    { action: string; title: string; text: string; confirmText: string }
  > = {
    confirm: {
      action: path.to.contractConfirm(id),
      title: t`Confirm ${readableId}`,
      text: t`Confirming fixes the invoice schedule and starts invoicing. The terms and lines are then changed with Amend.`,
      confirmText: t`Confirm`
    },
    invoice: {
      action: path.to.contractInvoice(id),
      title: t`Invoice ${readableId} now?`,
      text: t`Invoices are drafted automatically on their invoice dates. Use this to draft whatever is due right away. Invoices then follow this contract's invoicing setting.`,
      confirmText: t`Invoice`
    },
    revert: {
      action: path.to.contractRevertCancellation(id),
      title: t`Revert cancellation of ${readableId}`,
      text: t`Reverting restores the end date, renewal and line end dates the cancellation changed.`,
      confirmText: t`Revert Cancellation`
    }
  };

  const current = action ? confirmProps[action] : null;

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between gap-x-4 p-2 bg-card border-b h-[var(--header-height)] overflow-x-auto scrollbar-hide">
        <HStack className="w-full justify-between">
          <HStack className="min-w-0">
            <IconButton
              aria-label={t`Toggle Explorer`}
              icon={<LuPanelLeft />}
              onClick={toggleExplorer}
              variant="ghost"
            />
            <Link to={path.to.contractDetails(id)} className="min-w-0">
              <Heading size="h4" className="flex items-center gap-2 min-w-0">
                <span className="whitespace-nowrap">{readableId}</span>
                {contract.name && (
                  <span className="text-muted-foreground font-normal truncate">
                    {contract.name}
                  </span>
                )}
              </Heading>
            </Link>
            <Copy text={readableId} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  destructive
                  disabled={!isDraft || !permissions.can("delete", "sales")}
                  onClick={deleteDisclosure.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Contract</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ContractStatus status={status} />
            {isCancelled && contract.endDate && (
              <Badge variant="orange" className="whitespace-nowrap">
                <Trans>Ends {formatDate(contract.endDate)}</Trans>
              </Badge>
            )}
          </HStack>
          <HStack>
            {canRevertCancellation && (
              <Button
                variant="secondary"
                leftIcon={<LuUndo2 />}
                isDisabled={!canUpdate}
                onClick={() => open("revert")}
              >
                <Trans>Revert Cancellation</Trans>
              </Button>
            )}
            {isActive && (
              <>
                {/* A cancelled contract is reverted, not cancelled again. */}
                <Button
                  variant="secondary"
                  leftIcon={<LuCircleStop />}
                  isDisabled={!canUpdate || isCancelled}
                  onClick={cancelDisclosure.onOpen}
                >
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  variant="secondary"
                  leftIcon={<LuPencilLine />}
                  isDisabled={!canUpdate}
                  onClick={amendDisclosure.onOpen}
                >
                  <Trans>Amend</Trans>
                </Button>
                <Button
                  variant="primary"
                  leftIcon={<LuCreditCard />}
                  isDisabled={!canUpdate}
                  onClick={() => open("invoice")}
                >
                  <Trans>Invoice</Trans>
                </Button>
              </>
            )}
            {isDraft && (
              <Button
                variant="primary"
                leftIcon={<LuCircleCheck />}
                isDisabled={!canUpdate || !hasLines}
                onClick={() => open("confirm")}
              >
                <Trans>Confirm</Trans>
              </Button>
            )}
          </HStack>
        </HStack>
      </div>

      {current && confirm.isOpen && (
        <Confirm
          action={current.action}
          title={current.title}
          text={current.text}
          confirmText={current.confirmText}
          onCancel={confirm.onClose}
          onSubmit={confirm.onClose}
        />
      )}

      {amendDisclosure.isOpen && (
        <ContractAmendModal
          contract={contract}
          lines={lines}
          action={path.to.contractAmend(id)}
          onClose={amendDisclosure.onClose}
        />
      )}

      {cancelDisclosure.isOpen && (
        <ContractCancelModal
          contract={contract}
          action={path.to.contractCancel(id)}
          onClose={cancelDisclosure.onClose}
        />
      )}

      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteContract(id)}
          isOpen={deleteDisclosure.isOpen}
          name={readableId}
          text={t`Are you sure you want to delete ${readableId}? This cannot be undone.`}
          onCancel={deleteDisclosure.onClose}
          onSubmit={deleteDisclosure.onClose}
        />
      )}
    </>
  );
};

export default ContractHeader;
