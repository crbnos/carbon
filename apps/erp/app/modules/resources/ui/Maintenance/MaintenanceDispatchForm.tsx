import { useCarbon } from "@carbon/auth";
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
  toast,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { nanoid } from "nanoid";
import { useState } from "react";
import { BsExclamationSquareFill } from "react-icons/bs";
import type { z } from "zod";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import { Hidden, Location, Submit, WorkCenter } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";
import {
  maintenanceDispatchPriority,
  maintenanceDispatchValidator,
  maintenanceSeverity,
  maintenanceSource,
  oeeImpact
} from "../../resources.models";
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
  const permissions = usePermissions();
  const {
    company: { id: companyId }
  } = useUser();
  const { carbon } = useCarbon();

  const isEditing = initialValues.id !== undefined;
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

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/maintenance/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  return (
    <Card>
      <ValidatedForm
        validator={maintenanceDispatchValidator}
        method="post"
        action={path.to.newMaintenanceDispatch}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? "Edit" : "New"} Maintenance Dispatch
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              Create a new maintenance dispatch to track equipment repairs and
              maintenance activities
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
                <Label>Description</Label>
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
                label="Priority"
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
                label="Source"
                options={maintenanceSource.map((source) => ({
                  value: source,
                  label: <MaintenanceSource source={source} />
                }))}
              />
              <Select
                name="severity"
                label="Severity"
                options={maintenanceSeverity.map((severity) => ({
                  value: severity,
                  label: <MaintenanceSeverity severity={severity} />
                }))}
              />
              <WorkCenter name="workCenterId" label="Work Center" />
              <Location name="locationId" label="Location" />
              <Select
                name="oeeImpact"
                label="OEE Impact"
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
                label="Planned Start Time"
              />
              <DateTimePicker name="plannedEndTime" label="Planned End Time" />
              {showFailureModes ? (
                <Select
                  name="suspectedFailureModeId"
                  label="Suspected Failure Mode"
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
          <Submit isDisabled={isDisabled}>Save</Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default MaintenanceDispatchForm;
