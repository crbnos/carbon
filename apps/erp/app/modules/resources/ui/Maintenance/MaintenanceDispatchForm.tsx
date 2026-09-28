import { DateTimePicker, Select, ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Label,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { BsExclamationSquareFill } from "react-icons/bs";
import type { z } from "zod";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import {
  Boolean,
  Hidden,
  Location,
  Submit,
  WorkCenter
} from "~/components/Form";
import { useImageUpload, usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import {
  isMaintenanceDispatchLocked,
  maintenanceDispatchPriority,
  maintenanceDispatchValidator,
  maintenanceSeverity,
  maintenanceSource,
  oeeImpact
} from "../../resources.models";
import type { MaintenanceDispatchDetail } from "../../types";
import MaintenanceOeeImpact from "./MaintenanceOeeImpact";
import MaintenanceSeverity from "./MaintenanceSeverity";
import MaintenanceSource from "./MaintenanceSource";

function getPriorityIcon(
  priority: (typeof maintenanceDispatchPriority)[number]
) {
  switch (priority) {
    case "Critical":
      return <BsExclamationSquareFill className="text-red-500" />;
    case "High":
      return <HighPriorityIcon />;
    case "Medium":
      return <MediumPriorityIcon />;
    case "Low":
      return <LowPriorityIcon />;
  }
}

type MaintenanceDispatchFormProps = {
  initialValues: z.infer<typeof maintenanceDispatchValidator>;
  failureModes?: { id: string; name: string }[];
};

const MaintenanceDispatchForm = ({
  initialValues,
  failureModes = []
}: MaintenanceDispatchFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const isEditing = initialValues.id !== undefined;

  const routeData = useRouteData<{
    dispatch: MaintenanceDispatchDetail;
  }>(initialValues.id ? path.to.maintenanceDispatch(initialValues.id) : "");
  const isLocked = isMaintenanceDispatchLocked(routeData?.dispatch?.status);

  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  const [content, setContent] = useState<JSONContent>(
    initialValues?.content
      ? (JSON.parse(initialValues.content) as JSONContent)
      : {}
  );

  const [oeeImpactValue, setOeeImpactValue] = useState<string>(
    initialValues?.oeeImpact ?? "No Impact"
  );

  const showFailureModes =
    oeeImpactValue === "Down" || oeeImpactValue === "Impact";

  const onUploadImage = useImageUpload("maintenance");

  return (
    <Card>
      <ValidatedForm
        validator={maintenanceDispatchValidator}
        method="post"
        action={path.to.newMaintenanceDispatch}
        defaultValues={initialValues}
        isDisabled={isEditing && isLocked}
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? (
              <Trans>Edit Maintenance Dispatch</Trans>
            ) : (
              <Trans>New Maintenance Dispatch</Trans>
            )}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              <Trans>
                Create a new maintenance dispatch to track equipment repairs and
                maintenance activities
              </Trans>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <Hidden name="status" value="Open" />
          <Hidden name="content" value={JSON.stringify(content)} />
          <VStack>
            <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2">
              <div className="md:col-span-2 flex flex-col gap-2 w-full">
                <Label>
                  <Trans>Description</Trans>
                </Label>
                <Editor
                  initialValue={content}
                  onUpload={onUploadImage}
                  onChange={(value) => {
                    setContent(value);
                  }}
                  className="[&_.is-empty]:text-muted-foreground min-h-[120px] py-3 px-4 border rounded-md w-full"
                />
              </div>
              <Select
                name="priority"
                label={t`Priority`}
                options={maintenanceDispatchPriority.map((priority) => ({
                  value: priority,
                  label: (
                    <div className="flex gap-1 items-center">
                      {getPriorityIcon(priority)}
                      <span>{priority}</span>
                    </div>
                  )
                }))}
              />
              <Select
                name="source"
                label={t`Source`}
                termId="maintenance-dispatch-source"
                options={maintenanceSource.map((source) => ({
                  value: source,
                  label: <MaintenanceSource source={source} />
                }))}
              />
              <Select
                name="severity"
                label={t`Severity`}
                termId="maintenance-dispatch-severity"
                options={maintenanceSeverity.map((severity) => ({
                  value: severity,
                  label: <MaintenanceSeverity severity={severity} />
                }))}
              />
              <WorkCenter
                name="workCenterId"
                label={t`Work Center`}
                termId="work-center"
              />
              <Location name="locationId" label={t`Location`} />
              <Select
                name="oeeImpact"
                label={t`OEE Impact`}
                termId="maintenance-dispatch-oee-impact"
                options={oeeImpact.map((impact) => ({
                  value: impact,
                  label: <MaintenanceOeeImpact oeeImpact={impact} />
                }))}
                onChange={(option) => {
                  if (option?.value) {
                    setOeeImpactValue(option.value);
                  }
                }}
              />
              <DateTimePicker
                name="plannedStartTime"
                label={t`Planned Start Time`}
              />
              <DateTimePicker
                name="plannedEndTime"
                label={t`Planned End Time`}
              />

              <Boolean
                bordered
                className="col-span-2"
                name="takesWorkCenterOffline"
                label={t`Takes work center offline`}
                description={t`While this dispatch is open, the work center is unavailable to the schedule (until the planned end time, or until the dispatch is completed).`}
              />
              {showFailureModes ? (
                <Select
                  name="suspectedFailureModeId"
                  label={t`Suspected Failure Mode`}
                  termId="maintenance-dispatch-suspected-failure-mode"
                  options={failureModes.map((mode) => ({
                    value: mode.id,
                    label: mode.name
                  }))}
                  isClearable
                />
              ) : (
                <div />
              )}
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={isDisabled}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default MaintenanceDispatchForm;
