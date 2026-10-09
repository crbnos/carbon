// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  MENU_ITEM_SHORTCUTS,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCircleCheck,
  LuCirclePlay,
  LuLoaderCircle,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { RecordAction, RecordHeader } from "~/components/Layout/RecordHeader";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { isMaintenanceDispatchLocked } from "../../resources.models";
import type { MaintenanceDispatchDetail } from "../../types";
import MaintenanceStatus from "./MaintenanceStatus";

const MaintenanceDispatchHeader = () => {
  const { t } = useLingui();
  const { dispatchId } = useParams();
  if (!dispatchId) throw new Error("dispatchId not found");

  const routeData = useRouteData<{
    dispatch: MaintenanceDispatchDetail;
  }>(path.to.maintenanceDispatch(dispatchId));

  const status = routeData?.dispatch?.status;
  const isLocked = isMaintenanceDispatchLocked(status);
  const permissions = usePermissions();
  const statusFetcher = useFetcher<{}>();
  const deleteModal = useDisclosure();

  const statusBadge = <MaintenanceStatus status={status} />;
  const menuItems = (
    <>
      <DropdownMenuItem
        disabled={
          !["In Progress", "Completed"].includes(status ?? "") ||
          statusFetcher.state !== "idle" ||
          !permissions.can("update", "resources")
        }
        onClick={() => {
          statusFetcher.submit(
            { status: "Open" },
            {
              method: "post",
              action: path.to.maintenanceDispatchStatus(dispatchId)
            }
          );
        }}
      >
        <DropdownMenuIcon icon={<LuLoaderCircle />} />
        <Trans>Reopen</Trans>
      </DropdownMenuItem>
      <DropdownMenuItem
        shortcut={MENU_ITEM_SHORTCUTS.delete}
        destructive
        disabled={
          isLocked ||
          !permissions.can("delete", "resources") ||
          !permissions.is("employee")
        }
        onClick={deleteModal.onOpen}
      >
        <DropdownMenuIcon icon={<LuTrash />} />
        <Trans>Delete Dispatch</Trans>
      </DropdownMenuItem>
    </>
  );

  // Phones put the next status transition in the primary slot.
  const isStartable = status === "Open" || status === "Assigned";

  return (
    <>
      <RecordHeader
        title={routeData?.dispatch?.maintenanceDispatchId}
        titleTo={path.to.maintenanceDispatch(dispatchId)}
        copyValue={routeData?.dispatch?.maintenanceDispatchId ?? ""}
        menu={menuItems}
        status={statusBadge}
        actions={
          <>
            <RecordAction slot={isStartable ? "primary" : "secondary"}>
              <statusFetcher.Form
                method="post"
                action={path.to.maintenanceDispatchStatus(dispatchId)}
              >
                <input type="hidden" name="status" value="In Progress" />
                <Button
                  type="submit"
                  leftIcon={<LuCirclePlay />}
                  variant={
                    status === "Open" || status === "Assigned"
                      ? "primary"
                      : "secondary"
                  }
                  isDisabled={
                    !["Open", "Assigned"].includes(status ?? "") ||
                    statusFetcher.state !== "idle" ||
                    !permissions.can("update", "resources")
                  }
                  isLoading={
                    statusFetcher.state !== "idle" &&
                    statusFetcher.formData?.get("status") === "In Progress"
                  }
                >
                  <Trans>Start</Trans>
                </Button>
              </statusFetcher.Form>
            </RecordAction>

            <RecordAction slot={isStartable ? "secondary" : "primary"}>
              <statusFetcher.Form
                method="post"
                action={path.to.maintenanceDispatchStatus(dispatchId)}
              >
                <input type="hidden" name="status" value="Completed" />
                <Button
                  type="submit"
                  leftIcon={<LuCircleCheck />}
                  variant={status === "In Progress" ? "primary" : "secondary"}
                  isDisabled={
                    status !== "In Progress" ||
                    statusFetcher.state !== "idle" ||
                    !permissions.can("update", "resources")
                  }
                  isLoading={
                    statusFetcher.state !== "idle" &&
                    statusFetcher.formData?.get("status") === "Completed"
                  }
                >
                  <Trans>Complete</Trans>
                </Button>
              </statusFetcher.Form>
            </RecordAction>
          </>
        }
      />
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteMaintenanceDispatch(dispatchId)}
          isOpen={deleteModal.isOpen}
          name={routeData?.dispatch?.maintenanceDispatchId!}
          text={t`Are you sure you want to delete this maintenance dispatch? This cannot be undone.`}
          onCancel={() => {
            deleteModal.onClose();
          }}
          onSubmit={() => {
            deleteModal.onClose();
          }}
        />
      )}
    </>
  );
};

export default MaintenanceDispatchHeader;
