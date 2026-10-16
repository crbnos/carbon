// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  Count,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  ToggleGroup,
  ToggleGroupItem,
  toast,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuCalendar,
  LuCircleCheck,
  LuClock,
  LuFileCheck,
  LuSearch,
  LuTriangleAlert,
  LuUndo2
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { DateTime, EmployeeAvatar, Empty, FileDropzone } from "~/components";
import { Confirm } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { trainingCertificateAccept } from "~/modules/resources/resources.models";
import {
  getTrainingAssignment,
  getTrainingAssignmentStatus
} from "~/modules/resources/resources.service";
import type { TrainingAssignmentStatusItem } from "~/modules/resources/types";
import type { action as completeAction } from "~/routes/x+/resources+/assignments.complete";
import type { Handle } from "~/utils/handle";
import { getPrivateUrl, path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Detail`,
  to: path.to.trainingAssignments
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const { assignmentId } = params;
  if (!assignmentId) {
    throw redirect(
      path.to.trainingAssignments,
      await flash(request, error(null, "Assignment ID is required"))
    );
  }

  const [assignment, assignmentStatus] = await Promise.all([
    getTrainingAssignment(client, assignmentId),
    getTrainingAssignmentStatus(client, companyId, {
      trainingAssignmentId: assignmentId,
      status: undefined,
      search: undefined,
      limit: 10000,
      offset: 0,
      sorts: [],
      filters: []
    })
  ]);

  if (assignment.error || assignment.data.companyId !== companyId) {
    throw redirect(
      path.to.trainingAssignments,
      await flash(
        request,
        error(assignment.error, "Error loading training assignment")
      )
    );
  }

  if (assignmentStatus.error) {
    throw redirect(
      path.to.trainingAssignments,
      await flash(
        request,
        error(assignmentStatus.error, "Error loading assignment status")
      )
    );
  }

  return {
    name: assignment.data.training?.name ?? assignment.data.name ?? "",
    isExternal: assignment.data.trainingId === null,
    assignments: (assignmentStatus.data ?? []) as TrainingAssignmentStatusItem[]
  };
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "Completed":
      return (
        <Badge variant="green">
          <LuCircleCheck className="mr-1" />
          <Trans>Completed</Trans>
        </Badge>
      );
    case "Pending":
      return (
        <Badge variant="secondary">
          <LuClock className="mr-1" />
          <Trans>Pending</Trans>
        </Badge>
      );
    case "Overdue":
      return (
        <Badge variant="red">
          <LuTriangleAlert className="mr-1" />
          <Trans>Overdue</Trans>
        </Badge>
      );
    case "Not Required":
      return (
        <Badge variant="outline">
          <Trans>Not Required</Trans>
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

type StatusFilter =
  | "All"
  | "Completed"
  | "Pending"
  | "Overdue"
  | "Not Required";

function CertificateCompleteModal({
  assignment,
  onClose
}: {
  assignment: TrainingAssignmentStatusItem;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction<typeof completeAction>({
    onSuccess: () => {
      toast.success(t`Training marked as complete`);
      onClose();
    }
  });
  const isSubmitting = fetcher.state !== "idle";
  const [file, setFile] = useState<File | null>(null);

  const onSubmit = () => {
    const formData = new FormData();
    formData.append("trainingAssignmentId", assignment.trainingAssignmentId);
    formData.append("employeeId", assignment.employeeId);
    if (file) formData.append("certificate", file);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.markTrainingComplete,
      encType: "multipart/form-data"
    });
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{t`Mark Complete`}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Mark {assignment.employeeName?.trim()} complete. Attach their
                certificate if you have one.
              </Trans>
            </p>
            <FileDropzone
              onDrop={(files) => setFile(files[0] ?? null)}
              accept={{
                ...trainingCertificateAccept,
                "image/heic": [".heic", ".heif"]
              }}
              multiple={false}
              disabled={isSubmitting}
              className="mt-0 w-full"
            />
            {file && (
              <HStack spacing={2} className="text-sm">
                <LuFileCheck className="text-emerald-500" />
                <span className="break-all">{file.name}</span>
              </HStack>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            onClick={onSubmit}
            isDisabled={isSubmitting}
            isLoading={isSubmitting}
            leftIcon={<LuCircleCheck />}
          >
            <Trans>Mark Complete</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function AssignmentListItem({
  assignment,
  isExternal,
  canRemove,
  disabled,
  isLast
}: {
  assignment: TrainingAssignmentStatusItem;
  isExternal: boolean;
  canRemove: boolean;
  disabled: boolean;
  isLast: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useAction<typeof completeAction>({
    onSuccess: () => toast.success(t`Training marked as complete`)
  });
  const isSubmitting = fetcher.state !== "idle";
  const employeeName = assignment.employeeName?.trim() ?? "";
  const canMarkComplete =
    assignment.status !== "Completed" && assignment.status !== "Not Required";
  const [isCertificateOpen, setIsCertificateOpen] = useState(false);
  // Hold the completion id from when the dialog opened: the row loses its
  // completionId as soon as the removal revalidates, and the dialog must stay
  // mounted until its submission settles so it can close itself.
  const [removeCompletionId, setRemoveCompletionId] = useState<number | null>(
    null
  );

  return (
    <div className={cn("p-4", !isLast && "border-b w-full")}>
      <div className="flex flex-1 justify-between items-center w-full">
        <HStack spacing={4} className="flex-1">
          <VStack spacing={0} className="flex-1">
            <EmployeeAvatar employeeId={assignment.employeeId} />
            {assignment.employeeStartDate && (
              <HStack spacing={1} className="text-xs text-muted-foreground">
                <LuCalendar className="size-3" />
                <span>
                  <Trans>Started</Trans>{" "}
                  <DateTime
                    value={assignment.employeeStartDate}
                    variant="date"
                  />
                </span>
              </HStack>
            )}
          </VStack>
        </HStack>
        <HStack spacing={4}>
          <StatusBadge status={assignment.status} />
          {assignment.completedAt && (
            <span className="text-xs text-muted-foreground">
              <LuClock className="inline mr-1 size-3" />
              <DateTime value={assignment.completedAt} variant="date" />
            </span>
          )}
          {assignment.certificatePath && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LuFileCheck />}
              asChild
            >
              <a
                href={getPrivateUrl(assignment.certificatePath)}
                target="_blank"
                rel="noreferrer"
              >
                <Trans>View Certificate</Trans>
              </a>
            </Button>
          )}
          {assignment.status === "Completed" &&
            assignment.completionId &&
            canRemove && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<LuUndo2 />}
                onClick={() => setRemoveCompletionId(assignment.completionId)}
              >
                <Trans>Remove Completion</Trans>
              </Button>
            )}
          {canMarkComplete && isExternal && (
            <Button
              variant="secondary"
              size="sm"
              isDisabled={disabled}
              leftIcon={<LuCircleCheck />}
              onClick={() => setIsCertificateOpen(true)}
            >
              <Trans>Mark Complete</Trans>
            </Button>
          )}
          {canMarkComplete && !isExternal && (
            <fetcher.Form method="post" action={path.to.markTrainingComplete}>
              <input
                type="hidden"
                name="trainingAssignmentId"
                value={assignment.trainingAssignmentId}
              />
              <input
                type="hidden"
                name="employeeId"
                value={assignment.employeeId}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={disabled || isSubmitting}
                isLoading={isSubmitting}
                leftIcon={<LuCircleCheck />}
              >
                <Trans>Mark Complete</Trans>
              </Button>
            </fetcher.Form>
          )}
        </HStack>
      </div>
      {isCertificateOpen && (
        <CertificateCompleteModal
          assignment={assignment}
          onClose={() => setIsCertificateOpen(false)}
        />
      )}
      {removeCompletionId !== null && (
        <Confirm
          action={path.to.markTrainingIncomplete}
          title={t`Remove Completion`}
          text={t`The training goes back to Pending for ${employeeName}. The employee keeps any ability this training granted. Remove it on their Abilities page if needed.`}
          confirmText={t`Remove`}
          confirmVariant="destructive"
          onCancel={() => setRemoveCompletionId(null)}
          onSubmit={() => setRemoveCompletionId(null)}
        >
          <input type="hidden" name="completionId" value={removeCompletionId} />
        </Confirm>
      )}
    </div>
  );
}

export default function TrainingAssignmentDetailRoute() {
  const { t } = useLingui();
  const { name, isExternal, assignments } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");

  const currentPeriod =
    assignments.length > 0 ? assignments[0].currentPeriod : null;

  const filteredAssignments = useMemo(() => {
    return assignments.filter((assignment) => {
      const matchesSearch =
        (search === "" ||
          assignment.employeeName
            ?.toLowerCase()
            .includes(search.toLowerCase())) ??
        false;
      const matchesStatus =
        statusFilter === "All" || assignment.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [assignments, search, statusFilter]);

  const statusCounts = useMemo(() => {
    return assignments.reduce(
      (acc, assignment) => {
        acc[assignment.status] = (acc[assignment.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [assignments]);

  const onClose = () => navigate(path.to.trainingAssignments);

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent size="lg">
        <DrawerHeader>
          <HStack className="justify-between w-full pr-8">
            <HStack spacing={2}>
              <DrawerTitle>{name}</DrawerTitle>
              {currentPeriod && (
                <Badge variant="secondary">{currentPeriod}</Badge>
              )}
            </HStack>
          </HStack>
        </DrawerHeader>
        <DrawerBody className="p-0 max-md:p-0">
          <VStack spacing={0} className="h-full w-full">
            <div className="p-4 border-b flex flex-col gap-4 w-full">
              <div className="relative">
                <LuSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder={t`Search employees...`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <ToggleGroup
                type="single"
                value={statusFilter}
                onValueChange={(value) => {
                  if (value) setStatusFilter(value as StatusFilter);
                }}
                className="justify-start flex-wrap"
              >
                <ToggleGroupItem
                  className="flex gap-1.5 items-center"
                  size="sm"
                  value="All"
                >
                  <Trans>All</Trans> <Count count={assignments.length} />
                </ToggleGroupItem>
                <ToggleGroupItem
                  className="flex gap-1.5 items-center"
                  size="sm"
                  value="Completed"
                >
                  <LuCircleCheck className="mr-1 size-3" />
                  <Trans>Completed</Trans>{" "}
                  {/** biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration */}
                  <Count count={statusCounts["Completed"] || 0} />
                </ToggleGroupItem>
                <ToggleGroupItem
                  className="flex gap-1.5 items-center"
                  size="sm"
                  value="Pending"
                >
                  <LuClock className="mr-1 size-3" />
                  <Trans>Pending</Trans>{" "}
                  {/** biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration */}
                  <Count count={statusCounts["Pending"] || 0} />
                </ToggleGroupItem>
                <ToggleGroupItem
                  className="flex gap-1.5 items-center"
                  size="sm"
                  value="Overdue"
                >
                  <LuTriangleAlert className="mr-1 size-3" />
                  <Trans>Overdue</Trans>{" "}
                  {/** biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration */}
                  <Count count={statusCounts["Overdue"] || 0} />
                </ToggleGroupItem>
                <ToggleGroupItem
                  className="flex gap-1.5 items-center"
                  size="sm"
                  value="Not Required"
                >
                  <Trans>Not Required</Trans>{" "}
                  <Count count={statusCounts["Not Required"] || 0} />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="flex-1 overflow-y-auto w-full p-4">
              {filteredAssignments.length > 0 ? (
                <div className="border rounded-lg w-full">
                  {filteredAssignments.map((assignment, index) => (
                    <AssignmentListItem
                      key={`${assignment.employeeId}-${assignment.trainingAssignmentId}`}
                      assignment={assignment}
                      isExternal={isExternal}
                      canRemove={permissions.can("delete", "resources")}
                      disabled={!permissions.can("update", "resources")}
                      isLast={index === filteredAssignments.length - 1}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground p-8">
                  <VStack
                    spacing={2}
                    className="w-full items-center justify-center"
                  >
                    <Empty>
                      <Trans>No employees found</Trans>
                    </Empty>
                    {search && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSearch("")}
                      >
                        <Trans>Clear search</Trans>
                      </Button>
                    )}
                  </VStack>
                </div>
              )}
            </div>
          </VStack>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
