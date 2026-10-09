// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  ApprovalDecision,
  DocumentApprovalState
} from "@carbon/ee/approvals";
import {
  Button,
  Copy,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  Status,
  useDisclosure,
  VStack
} from "@carbon/react";
import { formatDateTime } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useState } from "react";
import {
  LuCheckCheck,
  LuCircleCheck,
  LuCircleStop,
  LuClipboardCheck,
  LuEllipsisVertical,
  LuLoaderCircle,
  LuStepForward,
  LuTrash,
  LuX
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import ApprovalDecisionModal from "~/components/Modals/ApprovalDecision";
import Confirm from "~/components/Modals/Confirm/Confirm";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  type changeNoticeStatus,
  changeNoticeStatusTransitions,
  isChangeNoticeLocked
} from "../../items.models";
import type { ChangeNotice } from "../../types";
import ChangeNoticeStatus from "./ChangeNoticeStatus";
import { setReleaseDialogOpen } from "./releaseDialog.store";

const ChangeNoticeHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    changeNotice: ChangeNotice;
    approval: DocumentApprovalState | null;
  }>(path.to.changeNotice(id));

  const status = routeData?.changeNotice?.status ?? "Draft";
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const { locale } = useLocale();
  const statusFetcher = useFetcher<{}>();
  const approvalFetcher = useFetcher<unknown>();
  const [approvalDecision, setApprovalDecision] =
    useState<ApprovalDecision | null>(null);
  const deleteModal = useDisclosure();
  const cancelModal = useDisclosure();

  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "changeOrder",
    entityId: id,
    companyId: company.id,
    variant: "dropdown",
    downloadable: true,
    downloadName: routeData?.changeNotice?.changeOrderId ?? undefined
  });

  const approval = routeData?.approval;
  const pendingRequestId = approval?.pendingRequestId ?? null;
  // The loader only reads approval state at Engineering Complete, the gated
  // step: with a rule on, advancing submits for approval instead.
  const submitsForApproval = approval?.isRequired ?? false;
  const lastRejection =
    approval?.lastDecision?.status === "Rejected"
      ? approval.lastDecision
      : null;

  const changeOrderId = routeData?.changeNotice?.changeOrderId ?? "";
  const isLocked = isChangeNoticeLocked(status);
  const nextStatus =
    changeNoticeStatusTransitions[
      status as (typeof changeNoticeStatus)[number]
    ]?.[0] ?? null;

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between gap-x-4 px-4 py-2 bg-card border-b border-border h-[var(--header-height)] overflow-x-auto scrollbar-hide">
        <VStack spacing={0}>
          <HStack>
            <Link to={path.to.changeNoticeDetails(id)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData?.changeNotice?.changeOrderId}</span>
              </Heading>
            </Link>
            <span className={cn(isLocked && "line-through")}>
              <ChangeNoticeStatus status={routeData?.changeNotice?.status} />
            </span>
            {pendingRequestId && (
              <Status color="yellow">
                <Trans>Pending Approval</Trans>
              </Status>
            )}
            {lastRejection && (
              <Status
                color="red"
                tooltip={
                  <VStack spacing={1} className="max-w-xs">
                    {lastRejection.decisionAt && (
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(lastRejection.decisionAt, locale)}
                      </span>
                    )}
                    <span>
                      {lastRejection.notes || t`No notes were given.`}
                    </span>
                  </VStack>
                }
              >
                <Trans>Approval Rejected</Trans>
              </Status>
            )}
            <Copy text={routeData?.changeNotice?.changeOrderId ?? ""} />
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
                {auditLogTrigger}
                {status === "Cancelled" && (
                  <DropdownMenuItem
                    disabled={
                      statusFetcher.state !== "idle" ||
                      !permissions.can("update", "parts")
                    }
                    onClick={() => {
                      statusFetcher.submit(
                        { id, fromStatus: status, status: "Draft" },
                        {
                          method: "post",
                          action: path.to.changeNoticeStatus(id)
                        }
                      );
                    }}
                  >
                    <DropdownMenuIcon icon={<LuLoaderCircle />} />
                    {t`Reopen`}
                  </DropdownMenuItem>
                )}
                {/* Reopen from Implementation goes back one stage so the
                    engineering content unlocks without losing progress. */}
                {status === "Implementation" && (
                  <DropdownMenuItem
                    disabled={
                      statusFetcher.state !== "idle" ||
                      !permissions.can("update", "parts")
                    }
                    onClick={() => {
                      statusFetcher.submit(
                        {
                          id,
                          fromStatus: status,
                          status: "Engineering Complete"
                        },
                        {
                          method: "post",
                          action: path.to.changeNoticeStatus(id)
                        }
                      );
                    }}
                  >
                    <DropdownMenuIcon icon={<LuLoaderCircle />} />
                    {t`Reopen`}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  shortcut={MENU_ITEM_SHORTCUTS.delete}
                  destructive
                  disabled={
                    !permissions.can("delete", "parts") ||
                    !permissions.is("employee")
                  }
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  {t`Delete Change Notice`}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </VStack>

        <HStack spacing={2}>
          {/* The full stage flow (green-dot progress) lives in the middle pane
              (ChangeNoticeStatusFlow); the header keeps only the canonical status
              badge (above) + the advance/release action. */}

          {/* Cancel — a header action (opens the confirm modal) sitting beside the
              advance/release primary action. Reopen (from Cancelled) stays in the
              ⋮ menu. */}
          {status !== "Cancelled" && !isLocked && (
            <Button
              leftIcon={<LuCircleStop />}
              variant="secondary"
              isDisabled={!permissions.can("update", "parts")}
              onClick={cancelModal.onOpen}
            >
              {t`Cancel`}
            </Button>
          )}

          {/* Implementation → Done is a release: it opens the review + confirm
              dialog (which carries the merge resolution), not a one-click stage
              advance. The header only auto-advances the earlier stages. */}
          {pendingRequestId && approval?.canApprove && (
            <>
              <Button
                leftIcon={<LuCheckCheck />}
                variant="primary"
                isDisabled={approvalFetcher.state !== "idle"}
                onClick={() => setApprovalDecision("Approved")}
              >
                {t`Approve`}
              </Button>
              <Button
                leftIcon={<LuX />}
                variant="destructive"
                isDisabled={approvalFetcher.state !== "idle"}
                onClick={() => setApprovalDecision("Rejected")}
              >
                {t`Reject`}
              </Button>
            </>
          )}

          {/* With no rule left, no one can decide a pending request; advancing
              withdraws it. */}
          {nextStatus &&
            nextStatus !== "Done" &&
            !isLocked &&
            (!pendingRequestId || !submitsForApproval) && (
              <statusFetcher.Form
                method="post"
                action={path.to.changeNoticeStatus(id)}
              >
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="fromStatus" value={status} />
                <input type="hidden" name="status" value={nextStatus} />
                <Button
                  type="submit"
                  rightIcon={
                    submitsForApproval ? (
                      <LuClipboardCheck />
                    ) : (
                      <LuStepForward />
                    )
                  }
                  variant="primary"
                  isDisabled={
                    statusFetcher.state !== "idle" ||
                    !permissions.can("update", "parts")
                  }
                  isLoading={statusFetcher.state !== "idle"}
                >
                  {submitsForApproval
                    ? t`Submit for Approval`
                    : t`Advance to ${nextStatus}`}
                </Button>
              </statusFetcher.Form>
            )}

          {status === "Implementation" && !isLocked && (
            <Button
              leftIcon={<LuCircleCheck />}
              variant="primary"
              isDisabled={!permissions.can("update", "parts")}
              onClick={() => setReleaseDialogOpen(true)}
            >
              {t`Release`}
            </Button>
          )}
        </HStack>
      </div>
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteChangeNotice(id)}
          isOpen={deleteModal.isOpen}
          name={routeData?.changeNotice?.changeOrderId ?? ""}
          text={t`Are you sure you want to delete ${
            routeData?.changeNotice?.changeOrderId ?? ""
          }? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}
      {cancelModal.isOpen && (
        <Confirm
          action={path.to.changeNoticeStatus(id)}
          title={t`Cancel change notice`}
          text={t`Are you sure you want to cancel ${
            routeData?.changeNotice?.changeOrderId ?? ""
          }? It will be closed and read-only until you reopen it.`}
          confirmText={t`Cancel Change Notice`}
          cancelText={t`Keep Open`}
          confirmVariant="destructive"
          onCancel={cancelModal.onClose}
          onSubmit={cancelModal.onClose}
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="fromStatus" value={status} />
          <input type="hidden" name="status" value="Cancelled" />
        </Confirm>
      )}
      {approvalDecision && pendingRequestId && (
        <ApprovalDecisionModal
          action={path.to.changeNoticeApproval(id)}
          approvalRequestId={pendingRequestId}
          decision={approvalDecision}
          title={
            approvalDecision === "Approved"
              ? t`Approve ${changeOrderId}`
              : t`Reject ${changeOrderId}`
          }
          description={
            approvalDecision === "Approved"
              ? t`Are you sure you want to approve this change notice? This moves it to Implementation.`
              : t`Are you sure you want to reject this change notice? It stays at Engineering Complete so it can be changed and submitted again.`
          }
          fetcher={approvalFetcher}
          onClose={() => setApprovalDecision(null)}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default ChangeNoticeHeader;
