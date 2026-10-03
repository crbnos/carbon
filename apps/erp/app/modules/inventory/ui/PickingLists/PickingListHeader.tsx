// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  LuCircleCheck,
  LuCirclePlay,
  LuCircleStop,
  LuLoaderCircle,
  LuTrash,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import Assignee, { useOptimisticAssignment } from "~/components/Assignee";
import { DocumentPageHeader } from "~/components/DocumentPage";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import type {
  getPickingList,
  getPickingListLines,
  UnresolvedPickingListLine
} from "~/modules/inventory";
import { isPickingListLocked } from "~/modules/inventory";
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
  const statusFetcher = useFetcher<{
    needsAcknowledgement?: boolean;
    unresolvedLines?: UnresolvedPickingListLine[];
  }>();
  const [acknowledgeLines, setAcknowledgeLines] = useState<
    UnresolvedPickingListLine[] | null
  >(null);

  useEffect(() => {
    if (
      statusFetcher.data?.needsAcknowledgement &&
      statusFetcher.data.unresolvedLines
    ) {
      setAcknowledgeLines(statusFetcher.data.unresolvedLines);
    }
  }, [statusFetcher.data]);

  const isClosed = isPickingListLocked(status);
  const isSubmitting = statusFetcher.state !== "idle";
  const canUpdate = permissions.can("update", "inventory");
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

  const submitStatus = (next: string, acknowledged?: boolean) => {
    if (acknowledged !== true) setAcknowledgeLines(null);
    statusFetcher.submit(
      acknowledged ? { status: next, acknowledged: "true" } : { status: next },
      { method: "post", action: path.to.pickingListStatus(pickingListId) }
    );
  };

  const isSubmittingStatus = (next: string) =>
    isSubmitting && statusFetcher.formData?.get("status") === next;

  const locationName = pickingList.location?.name;

  return (
    <>
      <DocumentPageHeader
        title={pickingList.pickingListId}
        status={<PickingListStatus status={status} />}
        meta={[
          <Trans key="created">
            Created{" "}
            <DateTime value={pickingList.createdAt} variant="relative" /> by{" "}
            <EmployeeAvatar employeeId={pickingList.createdBy} />
          </Trans>,
          pickingList.dueDate ? (
            <Trans key="due">
              Due <DateTime value={pickingList.dueDate} variant="date" />
            </Trans>
          ) : null,
          locationName ? <Trans key="location">At {locationName}</Trans> : null
        ]}
        menuItems={
          <>
            {status !== "Draft" && (
              <DropdownMenuItem
                disabled={
                  isSubmitting || !permissions.can("delete", "inventory")
                }
                onClick={() => submitStatus("Draft")}
              >
                <DropdownMenuIcon icon={<LuLoaderCircle />} />
                <Trans>Reopen</Trans>
              </DropdownMenuItem>
            )}
            {!isClosed && (
              <DropdownMenuItem
                disabled={isSubmitting || !canUpdate}
                destructive
                onClick={() => submitStatus("Cancelled")}
              >
                <DropdownMenuIcon icon={<LuCircleStop />} />
                <Trans>Cancel Picking List</Trans>
              </DropdownMenuItem>
            )}
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
          </>
        }
        actions={
          <>
            <Assignee
              size="md"
              id={pickingListId}
              value={assignee ?? ""}
              table="pickingList"
              isReadOnly={!canUpdate}
            />
            {status === "Draft" && (
              <Button
                type="button"
                variant="primary"
                leftIcon={<LuCirclePlay />}
                isDisabled={isSubmitting || !canUpdate}
                isLoading={isSubmittingStatus("In Progress")}
                onClick={() => submitStatus("In Progress")}
              >
                <Trans>Start</Trans>
              </Button>
            )}
            {status === "In Progress" && (
              <Button
                type="button"
                variant="primary"
                leftIcon={<LuCircleCheck />}
                isDisabled={isSubmitting || !canUpdate}
                isLoading={isSubmittingStatus("Completed")}
                onClick={() => submitStatus("Completed")}
              >
                <Trans>Finish</Trans>
              </Button>
            )}
          </>
        }
      />

      {acknowledgeLines && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setAcknowledgeLines(null);
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <span className="flex items-center gap-2">
                  <LuTriangleAlert className="text-amber-500 h-5 w-5" />
                  <Trans>Finish with material unpicked?</Trans>
                </span>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <div className="flex flex-col gap-3 text-sm">
                <p className="text-muted-foreground">
                  <Trans>
                    These items still have material to pick. Finishing now marks
                    the list Partial.
                  </Trans>
                </p>
                <ul className="flex flex-col gap-1">
                  {acknowledgeLines.map((line, index) => (
                    <li
                      key={`${line.itemName}-${index}`}
                      className="flex items-center justify-between gap-4 rounded-md border px-3 py-2"
                    >
                      <span className="font-medium">{line.itemName}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {line.outstanding} <Trans>short</Trans>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => setAcknowledgeLines(null)}
                isDisabled={isSubmitting}
              >
                <Trans>Keep picking</Trans>
              </Button>
              <Button
                variant="solid"
                onClick={() => {
                  setAcknowledgeLines(null);
                  submitStatus("Completed", true);
                }}
                isLoading={isSubmitting}
                isDisabled={isSubmitting}
              >
                <Trans>Acknowledge & finish</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

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
