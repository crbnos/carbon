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
  useDisclosure,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import {
  LuCircleCheck,
  LuCircleStop,
  LuEllipsisVertical,
  LuLoaderCircle,
  LuStepForward,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import Confirm from "~/components/Modals/Confirm/Confirm";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  type changeOrderStatus,
  changeOrderStatusTransitions,
  isChangeOrderLocked
} from "../../items.models";
import type { ChangeOrder } from "../../types";
import ChangeOrderStatus from "./ChangeOrderStatus";
import { releaseDialogOpenAtom } from "./releaseDialog.store";

const ChangeOrderHeader = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{ changeOrder: ChangeOrder }>(
    path.to.changeOrder(id)
  );

  const status = routeData?.changeOrder?.status ?? "Draft";
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

  const isLocked = isChangeOrderLocked(status);
  const nextStatus =
    changeOrderStatusTransitions[
      status as (typeof changeOrderStatus)[number]
    ]?.[0] ?? null;

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
        <VStack spacing={0}>
          <HStack>
            <Link to={path.to.changeOrderDetails(id)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData?.changeOrder?.changeOrderId}</span>
              </Heading>
            </Link>
            <span className={cn(isLocked && "line-through")}>
              <ChangeOrderStatus status={routeData?.changeOrder?.status} />
            </span>
            <Copy text={routeData?.changeOrder?.changeOrderId ?? ""} />
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
                          action: path.to.changeOrderStatus(id)
                        }
                      );
                    }}
                  >
                    <DropdownMenuIcon icon={<LuLoaderCircle />} />
                    {t`Reopen`}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  destructive
                  disabled={
                    !permissions.can("delete", "parts") ||
                    !permissions.is("employee")
                  }
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  {t`Delete Change Order`}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </VStack>

        <HStack spacing={2}>
          {/* The full stage flow (green-dot progress) lives in the middle pane
              (ChangeOrderStatusFlow); the header keeps only the canonical status
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
          {nextStatus && nextStatus !== "Done" && !isLocked && (
            <statusFetcher.Form
              method="post"
              action={path.to.changeOrderStatus(id)}
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
          )}

          {status === "Implementation" && !isLocked && (
            <Button
              leftIcon={<LuCircleCheck />}
              variant="primary"
              isDisabled={!permissions.can("update", "parts")}
              onClick={() => releaseDialogOpenAtom.set(true)}
            >
              {t`Release`}
            </Button>
          )}
        </HStack>
      </div>
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteChangeOrder(id)}
          isOpen={deleteModal.isOpen}
          name={routeData?.changeOrder?.changeOrderId ?? ""}
          text={t`Are you sure you want to delete ${
            routeData?.changeOrder?.changeOrderId ?? ""
          }? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}
      {cancelModal.isOpen && (
        <Confirm
          action={path.to.changeOrderStatus(id)}
          title={t`Cancel change order`}
          text={t`Are you sure you want to cancel ${
            routeData?.changeOrder?.changeOrderId ?? ""
          }? It will be closed and read-only until you reopen it.`}
          confirmText={t`Cancel Change Order`}
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

export default ChangeOrderHeader;
