import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuCircleCheck,
  LuCirclePlay,
  LuCircleStop,
  LuEllipsisVertical,
  LuLoaderCircle,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import Assignee, { useOptimisticAssignment } from "~/components/Assignee";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import type { getPickingList, getPickingListLines } from "~/modules/inventory";
import { path } from "~/utils/path";
import PickingListStatus from "./PickingListStatus";

type PickingListData = NonNullable<
  Awaited<ReturnType<typeof getPickingList>>["data"]
>;
type PickingListLineData = NonNullable<
  Awaited<ReturnType<typeof getPickingListLines>>["data"]
>;

const PickingListHeader = () => {
  const { pickingListId } = useParams();
  if (!pickingListId) throw new Error("pickingListId not found");

  const routeData = useRouteData<{
    pickingList: PickingListData;
    pickingListLines: PickingListLineData;
  }>(path.to.pickingList(pickingListId));

  if (!routeData?.pickingList) throw new Error("Failed to load picking list");
  const pickingList = routeData.pickingList;
  const status = pickingList.status;

  const { t } = useLingui();
  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const statusFetcher = useFetcher();

  const isClosed = ["Completed", "Cancelled"].includes(status);
  const hasPickedLines = (routeData.pickingListLines ?? []).some(
    (l) => Number(l.quantityPicked ?? 0) > 0
  );

  const optimisticAssignment = useOptimisticAssignment({
    id: pickingListId,
    table: "pickingList"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : pickingList.assignee;

  const submitStatus = (next: string) => {
    statusFetcher.submit(
      { status: next },
      { method: "post", action: path.to.pickingListStatus(pickingListId) }
    );
  };

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1)]">
        <HStack className="w-full justify-between">
          <HStack>
            <Heading size="h4" className="flex items-center gap-2">
              <span>{pickingList.pickingListId}</span>
            </Heading>
            <Copy text={pickingList.pickingListId ?? ""} />
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
                    status === "Draft" ||
                    statusFetcher.state !== "idle" ||
                    !permissions.can("delete", "inventory")
                  }
                  onClick={() => submitStatus("Draft")}
                >
                  <DropdownMenuIcon icon={<LuLoaderCircle />} />
                  <Trans>Reopen</Trans>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={
                    status !== "Draft" ||
                    hasPickedLines ||
                    !permissions.can("delete", "inventory") ||
                    !permissions.is("employee")
                  }
                  destructive
                  onClick={deleteModal.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Picking List</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <PickingListStatus status={status} />
          </HStack>

          <HStack>
            <Assignee
              size="md"
              id={pickingListId}
              value={assignee ?? ""}
              table="pickingList"
              isReadOnly={!permissions.can("update", "inventory")}
            />
            <Button
              type="button"
              leftIcon={<LuCirclePlay />}
              variant={status === "Draft" ? "primary" : "secondary"}
              isDisabled={
                status !== "Draft" ||
                statusFetcher.state !== "idle" ||
                !permissions.can("update", "inventory")
              }
              isLoading={
                statusFetcher.state !== "idle" &&
                statusFetcher.formData?.get("status") === "In Progress"
              }
              onClick={() => submitStatus("In Progress")}
            >
              <Trans>Start</Trans>
            </Button>
            <Button
              type="button"
              leftIcon={<LuCircleCheck />}
              variant={status === "In Progress" ? "primary" : "secondary"}
              isDisabled={
                status !== "In Progress" ||
                statusFetcher.state !== "idle" ||
                !permissions.can("update", "inventory")
              }
              isLoading={
                statusFetcher.state !== "idle" &&
                statusFetcher.formData?.get("status") === "Completed"
              }
              onClick={() => submitStatus("Completed")}
            >
              <Trans>Complete</Trans>
            </Button>
            <Button
              type="button"
              variant="secondary"
              leftIcon={<LuCircleStop />}
              isDisabled={
                isClosed ||
                statusFetcher.state !== "idle" ||
                !permissions.can("update", "inventory")
              }
              isLoading={
                statusFetcher.state !== "idle" &&
                statusFetcher.formData?.get("status") === "Cancelled"
              }
              onClick={() => submitStatus("Cancelled")}
            >
              <Trans>Cancel</Trans>
            </Button>
          </HStack>
        </HStack>
      </div>

      {deleteModal.isOpen && (
        <ConfirmDelete
          action={path.to.pickingListDelete(pickingListId)}
          isOpen={deleteModal.isOpen}
          name={pickingList.pickingListId ?? "picking list"}
          text={t`Are you sure you want to delete ${pickingList.pickingListId}? This cannot be undone.`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}
    </>
  );
};

export default PickingListHeader;
