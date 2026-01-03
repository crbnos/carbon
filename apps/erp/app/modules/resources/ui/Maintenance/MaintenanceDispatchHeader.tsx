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
import type { MaintenanceDispatchDetail } from "../../types";
import MaintenanceStatus from "./MaintenanceStatus";

const MaintenanceDispatchHeader = () => {
  const { dispatchId } = useParams();
  if (!dispatchId) throw new Error("dispatchId not found");

  const routeData = useRouteData<{
    dispatch: MaintenanceDispatchDetail;
  }>(path.to.maintenanceDispatch(dispatchId));

  const status = routeData?.dispatch?.status;
  const permissions = usePermissions();
  const statusFetcher = useFetcher<{}>();
  const deleteModal = useDisclosure();

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
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
                  aria-label="More options"
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  destructive
                  disabled={
                    !permissions.can("delete", "resources") ||
                    !permissions.is("employee")
                  }
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  Delete Dispatch
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
              Start
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
              Complete
            </Button>
          </statusFetcher.Form>

          <statusFetcher.Form
            method="post"
            action={path.to.maintenanceDispatchStatus(dispatchId)}
          >
            <input type="hidden" name="status" value="Open" />
            <Button
              type="submit"
              leftIcon={<LuLoaderCircle />}
              variant={status === "Completed" ? "primary" : "secondary"}
              isDisabled={
                !["In Progress", "Completed"].includes(status ?? "") ||
                statusFetcher.state !== "idle" ||
                !permissions.can("update", "resources")
              }
            >
              Reopen
            </Button>
          </statusFetcher.Form>
        </HStack>
      </div>
      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteMaintenanceDispatch(dispatchId)}
          isOpen={deleteModal.isOpen}
          name={routeData?.dispatch?.maintenanceDispatchId!}
          text={`Are you sure you want to delete this maintenance dispatch? This cannot be undone.`}
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
