import { useCarbon } from "@carbon/auth";
import {
  DateTimePicker,
  Hidden,
  Select,
  Submit,
  ValidatedForm
} from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  HStack,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { BsExclamationSquareFill } from "react-icons/bs";
import { useFetcher } from "react-router";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import { useUser } from "~/hooks";
import {
  maintenanceDispatchPriority,
  maintenanceDispatchValidator,
  maintenanceSeverity,
  oeeImpact
} from "~/services/models";
import { getPrivateUrl, path } from "~/utils/path";

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

function getSeverityLabel(severity: (typeof maintenanceSeverity)[number]) {
  switch (severity) {
    case "Preventive":
      return "Preventive";
    case "Operator Performed":
      return "Operator Performed";
    case "Support Required":
      return "Support Required";
    case "OEM Required":
      return "OEM Required";
  }
}

export function MaintenanceDispatch({
  workCenter,
  isOpen,
  onClose
}: {
  workCenter: {
    id: string;
    name: string;
    isBlocked: boolean | null;
    blockingDispatchId: string | null;
  };
  isOpen: boolean;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ id?: string }>();
  const failureModeFetcher =
    useFetcher<
      PostgrestResponse<{
        id: string;
        name: string;
      }>
    >();
  const {
    company: { id: companyId }
  } = useUser();
  const { carbon } = useCarbon();

  const [content, setContent] = useState<JSONContent>({});
  const [severity, setSeverity] =
    useState<(typeof maintenanceSeverity)[number]>("Operator Performed");
  const [oeeImpactValue, setOeeImpactValue] =
    useState<(typeof oeeImpact)[number]>("No Impact");

  const failureModes = failureModeFetcher.data?.data ?? [];

  useEffect(() => {
    if (isOpen) {
      failureModeFetcher.load(path.to.api.failureModes);
    }
  }, [isOpen, failureModeFetcher.load]);

  const handleClose = () => {
    setContent({});
    setSeverity("Operator Performed");
    setOeeImpactValue("No Impact");
    onClose();
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.id) {
      toast.success("Maintenance dispatch created");
      handleClose();
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: ignore
  }, [fetcher.state, fetcher.data, handleClose]);

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

  if (!isOpen) return null;

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <ModalContent size="xlarge">
        <ValidatedForm
          method="post"
          action={path.to.newMaintenanceDispatch}
          validator={maintenanceDispatchValidator}
          defaultValues={{
            workCenterId: workCenter.id,
            priority: "Medium",
            severity: "Operator Performed",
            oeeImpact: "No Impact",
            suspectedFailureModeId: undefined,
            actualStartTime: new Date().toISOString(),
            actualEndTime: undefined
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>Maintenance for {workCenter.name}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="workCenterId" value={workCenter.id} />
            <Hidden name="content" value={JSON.stringify(content)} />
            <VStack spacing={4}>
              <div className="flex flex-col gap-2 w-full">
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
              <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 md:grid-cols-2">
                <Select
                  name="priority"
                  label="Priority"
                  size="lg"
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
                  name="severity"
                  label="Severity"
                  size="lg"
                  options={maintenanceSeverity.map((s) => ({
                    value: s,
                    label: getSeverityLabel(s)
                  }))}
                  onChange={(option) => {
                    if (option?.value) {
                      setSeverity(
                        option.value as (typeof maintenanceSeverity)[number]
                      );
                    }
                  }}
                />
                {severity === "Operator Performed" && (
                  <>
                    <DateTimePicker
                      name="actualStartTime"
                      label="Start Time"
                      size="lg"
                    />
                    <DateTimePicker
                      name="actualEndTime"
                      label="End Time"
                      size="lg"
                    />
                  </>
                )}
                <Select
                  name="oeeImpact"
                  label="OEE Impact"
                  size="lg"
                  options={oeeImpact.map((impact) => ({
                    value: impact,
                    label: impact
                  }))}
                  onChange={(option) => {
                    if (option?.value) {
                      setOeeImpactValue(
                        option.value as (typeof oeeImpact)[number]
                      );
                    }
                  }}
                />
                {(oeeImpactValue === "Down" || oeeImpactValue === "Impact") &&
                  failureModes.length > 0 &&
                  (severity === "Operator Performed" ? (
                    <Select
                      name="actualFailureModeId"
                      label="Actual Failure Mode"
                      size="lg"
                      options={failureModes.map((mode) => ({
                        value: mode.id,
                        label: mode.name
                      }))}
                      isClearable
                    />
                  ) : (
                    <Select
                      name="suspectedFailureModeId"
                      label="Suspected Failure Mode"
                      size="lg"
                      options={failureModes.map((mode) => ({
                        value: mode.id,
                        label: mode.name
                      }))}
                      isClearable
                    />
                  ))}
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="secondary" size="lg" onClick={handleClose}>
                Cancel
              </Button>
              <Submit size="lg">Create Dispatch</Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
