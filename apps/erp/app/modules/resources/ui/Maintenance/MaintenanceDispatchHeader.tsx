import {
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
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCircleCheck,
  LuCirclePlay,
  LuEllipsisVertical,
  LuLoaderCircle,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
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

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between gap-x-4 px-4 py-2 bg-card border-b border-border h-[var(--header-height)] overflow-x-auto scrollbar-hide">
        <VStack spacing={0}>
          <HStack>
            <Link to={path.to.maintenanceDispatch(dispatchId)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData?.dispatch?.maintenanceDispatchId}</span>
              </Heading>
            </Link>
            <MaintenanceStatus status={status} />
            <Copy text={routeData?.dispatch?.maintenanceDispatchId ?? ""} />
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
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </VStack>

        <HStack>
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
        </HStack>
      </div>
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
