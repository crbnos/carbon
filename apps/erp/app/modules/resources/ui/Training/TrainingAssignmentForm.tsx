import { Select, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  Count,
  cn,
  HStack,
  Input,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { memo, useMemo, useState } from "react";
import {
  LuCalendar,
  LuCircleCheck,
  LuClock,
  LuSearch,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { EmployeeAvatar, Empty } from "~/components";
import { Hidden, Submit, Users } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { trainingAssignmentValidator } from "~/modules/resources";
import type {
  TrainingAssignmentStatusItem,
  TrainingListItem
} from "~/modules/resources/types";
import { path } from "~/utils/path";

type TrainingAssignmentFormProps = {
  initialValues: z.infer<typeof trainingAssignmentValidator>;
  trainings: TrainingListItem[];
  assignmentStatus?: TrainingAssignmentStatusItem[];
  currentPeriod?: string | null;
  open?: boolean;
  onClose: () => void;
};

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "Completed":
      return (
        <Badge variant="green">
          <LuCircleCheck className="mr-1" />
          Completed
        </Badge>
      );
    case "Pending":
      return (
        <Badge variant="secondary">
          <LuClock className="mr-1" />
          Pending
        </Badge>
      );
    case "Overdue":
      return (
        <Badge variant="red">
          <LuTriangleAlert className="mr-1" />
          Overdue
        </Badge>
      );
    case "Not Required":
      return <Badge variant="outline">Not Required</Badge>;
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
                  Started{" "}
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

const StatusList = memo(
  ({
    data,
    currentPeriod
  }: {
    data: TrainingAssignmentStatusItem[];
    currentPeriod: string | null;
  }) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");

    const filteredAssignments = useMemo(() => {
      return data.filter((assignment) => {
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
    }, [data, search, statusFilter]);

    const statusCounts = useMemo(() => {
      return data.reduce(
        (acc, assignment) => {
          acc[assignment.status] = (acc[assignment.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
    }, [data]);

    return (
      <VStack spacing={0} className="h-full w-full">
        <div className="flex flex-col gap-4 w-full">
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
              All <Count count={data.length} />
            </ToggleGroupItem>
            <ToggleGroupItem
              className="flex gap-1.5 items-center"
              size="sm"
              value="Completed"
            >
              <LuCircleCheck className="mr-1 size-3" />
              Completed{" "}
              {/** biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration */}
              <Count count={statusCounts["Completed"] || 0} />
            </ToggleGroupItem>
            <ToggleGroupItem
              className="flex gap-1.5 items-center"
              size="sm"
              value="Pending"
            >
              <LuClock className="mr-1 size-3" />
              Pending{" "}
              {/** biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration */}
              <Count count={statusCounts["Pending"] || 0} />
            </ToggleGroupItem>
            <ToggleGroupItem
              className="flex gap-1.5 items-center"
              size="sm"
              value="Overdue"
            >
              <LuTriangleAlert className="mr-1 size-3" />
              Overdue{" "}
              {/** biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration */}
              <Count count={statusCounts["Overdue"] || 0} />
            </ToggleGroupItem>
            <ToggleGroupItem
              className="flex gap-1.5 items-center"
              size="sm"
              value="Not Required"
            >
              Not Required <Count count={statusCounts["Not Required"] || 0} />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex-1 overflow-y-auto w-full pt-4">
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
    );
  }
);

StatusList.displayName = "StatusList";

const TrainingAssignmentForm = ({
  initialValues,
  trainings,
  assignmentStatus = [],
  currentPeriod = null,
  open = true,
  onClose
}: TrainingAssignmentFormProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  const [activeTab, setActiveTab] = useState<string>("details");

  // Drawer grows when status tab is visible
  const drawerSize = activeTab === "status" ? "lg" : undefined;

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent size={drawerSize}>
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex flex-col h-full"
          >
            <ValidatedForm
              method="post"
              validator={trainingAssignmentValidator}
              defaultValues={initialValues}
              fetcher={fetcher}
              action={
                isEditing
                  ? path.to.trainingAssignment(initialValues.id!)
                  : path.to.newTrainingAssignment
              }
              className="flex flex-col h-full"
            >
              <ModalDrawerHeader className="flex flex-col gap-4">
                <HStack className="w-full justify-between pr-8">
                  <VStack>
                    <ModalDrawerTitle>
                      {isEditing ? (
                        <Trans>Edit Assignment</Trans>
                      ) : (
                        <Trans>New Assignment</Trans>
                      )}
                    </ModalDrawerTitle>
                  </VStack>

                  {isEditing && (
                    <div>
                      <TabsList>
                        <TabsTrigger value="details">
                          <Trans>Details</Trans>
                        </TabsTrigger>
                        <TabsTrigger value="status">
                          <Trans>Status</Trans>
                        </TabsTrigger>
                      </TabsList>
                    </div>
                  )}
                </HStack>
              </ModalDrawerHeader>
              <ModalDrawerBody className="w-full">
                <Hidden name="id" />

                {isEditing ? (
                  <>
                    <TabsContent value="details" className="w-full">
                      <AssignmentFormContent
                        trainings={trainings}
                        isEditing={isEditing}
                      />
                    </TabsContent>
                    <TabsContent
                      value="status"
                      className="w-full flex flex-col gap-4"
                    >
                      {assignmentStatus.length > 0 ? (
                        <StatusList
                          data={assignmentStatus}
                          currentPeriod={currentPeriod}
                        />
                      ) : (
                        <div className="py-8 text-center text-muted-foreground">
                          <Trans>
                            No employees assigned yet. Add groups to see status.
                          </Trans>
                        </div>
                      )}
                    </TabsContent>
                  </>
                ) : (
                  <AssignmentFormContent
                    trainings={trainings}
                    isEditing={isEditing}
                  />
                )}
              </ModalDrawerBody>
              <ModalDrawerFooter>
                <HStack>
                  <Submit
                    isLoading={fetcher.state !== "idle"}
                    isDisabled={fetcher.state !== "idle" || isDisabled}
                  >
                    <Trans>Save</Trans>
                  </Submit>
                  <Button size="md" variant="solid" onClick={onClose}>
                    <Trans>Cancel</Trans>
                  </Button>
                </HStack>
              </ModalDrawerFooter>
            </ValidatedForm>
          </Tabs>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

function AssignmentFormContent({
  trainings,
  isEditing
}: {
  trainings: TrainingListItem[];
  isEditing: boolean;
}) {
  const { t } = useLingui();
  return (
    <VStack spacing={4}>
      <Select
        name="trainingId"
        label={t`Training`}
        isReadOnly={isEditing}
        options={trainings.map((training) => ({
          label: training.name ?? "",
          value: training.id ?? ""
        }))}
      />
      <Users
        name="groupIds"
        label={t`Assign to Groups`}
        type="employee"
        helperText={t`Select the groups that should complete this training`}
      />
    </VStack>
  );
}

export default TrainingAssignmentForm;
