// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  DropdownMenuIcon,
  DropdownMenuItem,
  MENU_ITEM_SHORTCUTS,
  useDisclosure
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import {
  LuCircleCheck,
  LuCircleStop,
  LuLoaderCircle,
  LuStepForward,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
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

  const routeData = useRouteData<{ changeNotice: ChangeNotice }>(
    path.to.changeNotice(id)
  );

  const status = routeData?.changeNotice?.status ?? "Draft";
  const { t } = useLingui();
  const permissions = usePermissions();
  const { company } = useUser();
  const statusFetcher = useFetcher<{}>();
  const deleteModal = useDisclosure();
  const cancelModal = useDisclosure();

  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "changeOrder",
    entityId: id,
    companyId: company.id,
    variant: "dropdown"
  });

  const isLocked = isChangeNoticeLocked(status);
  const nextStatus =
    changeNoticeStatusTransitions[
      status as (typeof changeNoticeStatus)[number]
    ]?.[0] ?? null;

  const statusBadge = (
    <span className={cn(isLocked && "line-through")}>
      <ChangeNoticeStatus status={routeData?.changeNotice?.status} />
    </span>
  );
  const menuItems = (
    <>
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
          !permissions.can("delete", "parts") || !permissions.is("employee")
        }
        onClick={deleteModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuTrash />} />
        {t`Delete Change Notice`}
      </DropdownMenuItem>
    </>
  );

  return (
    <>
      <RecordHeader
        title={routeData?.changeNotice?.changeOrderId}
        titleTo={path.to.changeNoticeDetails(id)}
        copyValue={routeData?.changeNotice?.changeOrderId ?? ""}
        menu={menuItems}
        status={statusBadge}
        actions={
          <>
            {/* The full stage flow (green-dot progress) lives in the middle pane
            (ChangeNoticeStatusFlow); the header keeps only the canonical status
            badge (above) + the advance/release action. */}

            {/* Cancel — a header action (opens the confirm modal) sitting beside the
            advance/release primary action. Reopen (from Cancelled) stays in the
            ⋮ menu. */}
            {status !== "Cancelled" && !isLocked && (
              <RecordAction slot="secondary">
                <Button
                  leftIcon={<LuCircleStop />}
                  variant="secondary"
                  isDisabled={!permissions.can("update", "parts")}
                  onClick={cancelModal.onOpen}
                >
                  {t`Cancel`}
                </Button>
              </RecordAction>
            )}

            {/* Implementation → Done is a release: it opens the review + confirm
            dialog (which carries the merge resolution), not a one-click stage
            advance. The header only auto-advances the earlier stages. */}
            {nextStatus && nextStatus !== "Done" && !isLocked && (
              <RecordAction slot="primary">
                <statusFetcher.Form
                  method="post"
                  action={path.to.changeNoticeStatus(id)}
                >
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="fromStatus" value={status} />
                  <input type="hidden" name="status" value={nextStatus} />
                  <Button
                    type="submit"
                    rightIcon={<LuStepForward />}
                    variant="primary"
                    isDisabled={
                      statusFetcher.state !== "idle" ||
                      !permissions.can("update", "parts")
                    }
                    isLoading={statusFetcher.state !== "idle"}
                  >
                    {t`Advance to ${nextStatus}`}
                  </Button>
                </statusFetcher.Form>
              </RecordAction>
            )}

            {status === "Implementation" && !isLocked && (
              <RecordAction slot="primary">
                <Button
                  leftIcon={<LuCircleCheck />}
                  variant="primary"
                  isDisabled={!permissions.can("update", "parts")}
                  onClick={() => setReleaseDialogOpen(true)}
                >
                  {t`Release`}
                </Button>
              </RecordAction>
            )}
          </>
        }
      />
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
      {auditLogDrawer}
    </>
  );
};

export default ChangeNoticeHeader;
