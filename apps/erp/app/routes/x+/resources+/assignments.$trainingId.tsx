import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
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
  ToggleGroup,
  ToggleGroupItem,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo, useState } from "react";
import {
  LuCalendar,
  LuCircleCheck,
  LuClock,
  LuSearch,
  LuTriangleAlert
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { EmployeeAvatar, Empty } from "~/components";
import { usePermissions } from "~/hooks";
import { getTraining, getTrainingAssignmentStatus } from "~/modules/resources";
import type { TrainingAssignmentStatusItem } from "~/modules/resources/types";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Detail`,
  to: path.to.trainingAssignments
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const { trainingId } = params;
  if (!trainingId) {
    throw redirect(
      path.to.trainingAssignments,
      await flash(request, error(null, "Training ID is required"))
    );
  }

  const [training, assignmentStatus] = await Promise.all([
    getTraining(client, trainingId),
    getTrainingAssignmentStatus(client, companyId, {
      trainingId,
      status: undefined,
      search: undefined,
      limit: 10000,
      offset: 0,
      sorts: [],
      filters: []
    })
  ]);

  if (training.error) {
    throw redirect(
      path.to.trainingAssignments,
      await flash(request, error(training.error, "Error loading training"))
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
    training: training.data,
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

function AssignmentListItem({
  assignment,
  currentPeriod,
  disabled,
  isLast
}: {
  assignment: TrainingAssignmentStatusItem;
  currentPeriod: string | null;
  disabled: boolean;
  isLast: boolean;
}) {
  const fetcher = useFetcher();
  const { locale } = useLocale();
  const isSubmitting = fetcher.state !== "idle";
  const canMarkComplete =
    assignment.status !== "Completed" && assignment.status !== "Not Required";

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
                  {new Date(assignment.employeeStartDate).toLocaleDateString(
                    locale
                  )}
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
              {new Date(assignment.completedAt).toLocaleDateString(locale)}
            </span>
          )}
          {canMarkComplete && (
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
              <input type="hidden" name="period" value={currentPeriod ?? ""} />
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
    </div>
  );
}

export default function TrainingAssignmentDetailRoute() {
  const { t } = useLingui();
  const { training, assignments } = useLoaderData<typeof loader>();
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
              <DrawerTitle>{training?.name}</DrawerTitle>
              {currentPeriod && (
                <Badge variant="secondary">{currentPeriod}</Badge>
              )}
            </HStack>
          </HStack>
        </DrawerHeader>
        <DrawerBody className="p-0">
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
                      currentPeriod={currentPeriod}
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
