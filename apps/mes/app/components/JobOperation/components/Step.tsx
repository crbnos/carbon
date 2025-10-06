import {
  Button,
  Checkbox,
  cn,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Switch,
  toast,
  useDisclosure,
  VStack,
  type JSONContent,
} from "@carbon/react";
import { generateHTML } from "@carbon/react/Editor";
import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { useUser } from "~/hooks";
import { stepRecordValidator } from "~/services/models";
import type { JobOperationStep } from "~/services/types";
import { path } from "~/utils/path";

import { useCarbon } from "@carbon/auth";
import {
  Combobox,
  DateTimePicker,
  Hidden,
  Input as InputField,
  Number,
  Select,
  Submit,
  ValidatedForm,
} from "@carbon/form";
import { formatDateTime } from "@carbon/utils";
import {
  LuChevronDown,
  LuChevronRight,
  LuCircleCheck,
  LuFile,
  LuPaperclip,
  LuTrash,
} from "react-icons/lu";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { usePeople } from "~/stores";
import FileDropzone from "../../FileDropzone";

import { useNumberFormatter } from "@react-aria/i18n";

export function StepsListItem({
  activeStep,
  step,
  compact = false,
  operationId,
  className,
  onRecord,
  onDelete,
}: {
  activeStep: number;
  step: JobOperationStep;
  compact?: boolean;
  operationId?: string;
  className: string;
  onRecord: (step: JobOperationStep) => void;
  onDelete: (step: JobOperationStep) => void;
}) {
  const disclosure = useDisclosure();
  const fetcher = useFetcher<{ success: boolean }>();
  const user = useUser();
  const { name, description, type, unitOfMeasureCode, minValue, maxValue } =
    step;

  const hasDescription = description && Object.keys(description).length > 0;

  if (!operationId) return null;
  const record = step.jobOperationStepRecord.find(
    (r) => r.index === activeStep
  );

  return (
    <div className={cn("border-b hover:bg-muted/30 p-6", className)}>
      <div className="flex flex-1 justify-between items-center w-full gap-2">
        <HStack spacing={4} className="w-2/3">
          <HStack spacing={4} className="flex-1">
            <div className="bg-muted border rounded-full flex items-center justify-center p-2">
              <ProcedureStepTypeIcon type={type} />
            </div>
            <VStack spacing={0}>
              <HStack>
                <span className="text-foreground text-sm font-medium">
                  {name}
                </span>
              </HStack>
              {type === "Measurement" && (
                <span className="text-xs text-muted-foreground">
                  {minValue !== null && maxValue !== null
                    ? `Must be between ${minValue} and ${maxValue} ${unitOfMeasureCode}`
                    : minValue !== null
                    ? `Must be > ${minValue} ${unitOfMeasureCode}`
                    : maxValue !== null
                    ? `Must be < ${maxValue} ${unitOfMeasureCode}`
                    : null}
                </span>
              )}
            </VStack>
            {!compact && (
              <PreviewStepRecord step={step} activeStep={activeStep} />
            )}
          </HStack>
        </HStack>
        <div className="flex items-center justify-end gap-2">
          {record ? (
            <div className="flex items-center gap-2">
              {type !== "Task" &&
                (compact ? (
                  <IconButton
                    aria-label="Update step"
                    variant="secondary"
                    icon={<LuCircleCheck />}
                    isDisabled={record?.createdBy !== user?.id}
                    onClick={() => onRecord(step)}
                    className={cn(
                      "text-emerald-500",
                      step.minValue !== null &&
                        record?.numericValue != null &&
                        record?.numericValue < step.minValue &&
                        "text-red-500",
                      step.maxValue !== null &&
                        record?.numericValue != null &&
                        record?.numericValue > step.maxValue &&
                        "text-red-500"
                    )}
                  />
                ) : (
                  <Button
                    variant="secondary"
                    rightIcon={<LuCircleCheck />}
                    onClick={() => onRecord(step)}
                  >
                    Update
                  </Button>
                ))}
              <IconButton
                aria-label="Delete step"
                variant="secondary"
                icon={<LuTrash />}
                isDisabled={record?.createdBy !== user?.id}
                onClick={() => onDelete(step)}
              />
            </div>
          ) : type === "Task" ? (
            <fetcher.Form method="post" action={path.to.record}>
              <input type="hidden" name="index" value={activeStep} />
              <input type="hidden" name="jobOperationStepId" value={step.id} />

              <input type="hidden" name="booleanValue" value="true" />
              {compact ? (
                <IconButton
                  aria-label="Record step"
                  variant="secondary"
                  icon={<LuCircleCheck />}
                  type="submit"
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                />
              ) : (
                <Button
                  type="submit"
                  variant="secondary"
                  rightIcon={<LuCircleCheck />}
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                >
                  Complete
                </Button>
              )}
            </fetcher.Form>
          ) : compact ? (
            <IconButton
              aria-label="Record step"
              variant="secondary"
              icon={<LuCircleCheck />}
              onClick={() => onRecord(step)}
            />
          ) : (
            <Button
              variant="secondary"
              rightIcon={<LuCircleCheck />}
              onClick={() => onRecord(step)}
            >
              Record
            </Button>
          )}
          {hasDescription && (
            <IconButton
              aria-label={
                disclosure.isOpen ? "Hide description" : "Show description"
              }
              variant="ghost"
              icon={disclosure.isOpen ? <LuChevronDown /> : <LuChevronRight />}
              onClick={disclosure.onToggle}
            />
          )}
        </div>
      </div>
      {disclosure.isOpen && hasDescription && (
        <div
          className="mt-4 text-sm prose prose-sm dark:prose-invert"
          dangerouslySetInnerHTML={{
            __html: generateHTML(description as JSONContent),
          }}
        />
      )}
    </div>
  );
}

export function PreviewStepRecord({
  activeStep,
  step,
}: {
  activeStep: number;
  step: JobOperationStep;
}) {
  const [employees] = usePeople();
  const numberFormatter = useNumberFormatter();

  if (!step.jobOperationStepRecord) return null;
  const record = step.jobOperationStepRecord.find(
    (r) => r.index === activeStep
  );

  return (
    <div className="min-w-[200px] truncate text-right font-medium">
      {step.type === "Task" && (
        <Checkbox checked={record?.booleanValue ?? false} />
      )}
      {step.type === "Checkbox" && (
        <Checkbox checked={record?.booleanValue ?? false} />
      )}
      {step.type === "Value" && <p className="text-sm">{record?.value}</p>}
      {step.type === "Measurement" &&
        typeof record?.numericValue === "number" && (
          <p
            className={cn(
              "text-sm",
              step.minValue !== null &&
                record?.numericValue < step.minValue &&
                "text-red-500",
              step.maxValue !== null &&
                record?.numericValue > step.maxValue &&
                "text-red-500"
            )}
          >
            {numberFormatter.format(record?.numericValue)}{" "}
            {step.unitOfMeasureCode}
          </p>
        )}
      {step.type === "Timestamp" && (
        <p className="text-sm">{formatDateTime(record?.value ?? "")}</p>
      )}
      {step.type === "List" && <p className="text-sm">{record?.value}</p>}
      {step.type === "Person" && (
        <p className="text-sm">
          {employees.find((e) => e.id === record?.userValue)?.name}
        </p>
      )}
      {step.type === "File" && record?.value && (
        <div className="flex justify-end gap-2 text-sm">
          <LuPaperclip className="size-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

export function RecordModal({
  attribute,
  activeStep,
  onClose,
}: {
  attribute: JobOperationStep;
  activeStep: number;
  onClose: () => void;
}) {
  const [employees] = usePeople();
  const employeeOptions = useMemo(() => {
    return employees.map((employee) => ({
      label: employee.name,
      value: employee.id,
    }));
  }, [employees]);

  const { carbon } = useCarbon();
  const { company } = useUser();
  const [file, setFile] = useState<File | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);

  const fetcher = useFetcher<{ success: boolean }>();

  const onDrop = async (acceptedFiles: File[]) => {
    if (!acceptedFiles[0] || !carbon) return;
    const fileUpload = acceptedFiles[0];

    setFile(fileUpload);
    toast.info(`Uploading ${fileUpload.name}`);

    const fileName = `${company.id}/job/${attribute.operationId}/${fileUpload.name}`;

    const upload = await carbon?.storage
      .from("private")
      .upload(fileName, fileUpload, {
        cacheControl: `${12 * 60 * 60}`,
        upsert: true,
      });

    if (upload.error) {
      toast.error(`Failed to upload file: ${fileUpload.name}`);
    } else if (upload.data?.path) {
      toast.success(`Uploaded: ${fileUpload.name}`);
      setFilePath(upload.data.path);
    }
  };

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data?.success, onClose]);

  const record = attribute?.jobOperationStepRecord.find(
    (r) => r.index === activeStep
  );

  const [booleanControlled, setBooleanControlled] = useState(
    record?.booleanValue ?? false
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          validator={stepRecordValidator}
          action={path.to.record}
          onSubmit={onClose}
          defaultValues={{
            index: activeStep,
            jobOperationStepId: attribute.id,
            value:
              record?.value ??
              (attribute.type === "Timestamp" ? new Date().toISOString() : ""),
            numericValue: record?.numericValue ?? 0,
            userValue: record?.userValue ?? "",
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              {attribute.name} - Set {activeStep + 1}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" />
            <Hidden name="jobOperationStepId" />
            <Hidden name="index" />
            {attribute.type === "Checkbox" && (
              <Hidden
                name="booleanValue"
                value={booleanControlled ? "true" : "false"}
              />
            )}
            {attribute.type === "File" && (
              <Hidden name="value" value={filePath ?? ""} />
            )}
            <VStack spacing={4}>
              {attribute.description && (
                <div
                  className="flex flex-col gap-2"
                  dangerouslySetInnerHTML={{
                    __html: generateHTML(attribute.description as JSONContent),
                  }}
                />
              )}
              {attribute.type === "Value" && (
                <InputField name="value" label="" />
              )}
              {attribute.type === "Measurement" && (
                <Number name="numericValue" label="" />
              )}
              {attribute.type === "Timestamp" && (
                <DateTimePicker name="value" label="" />
              )}
              {attribute.type === "Checkbox" && (
                <Switch
                  checked={booleanControlled}
                  onCheckedChange={(checked) => setBooleanControlled(!!checked)}
                />
              )}
              {attribute.type === "Person" && (
                <Combobox name="userValue" label="" options={employeeOptions} />
              )}
              {attribute.type === "List" && (
                <Select
                  name="value"
                  label=""
                  options={(attribute.listValues ?? []).map((value) => ({
                    label: value,
                    value,
                  }))}
                />
              )}
              {attribute.type === "File" &&
                (file ? (
                  <div className="flex flex-col gap-2 items-center justify-center py-6 w-full">
                    <LuFile className="size-10 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{file.name}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setFile(null);
                        setFilePath(null);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <FileDropzone onDrop={onDrop} />
                ))}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Submit
              isLoading={fetcher.state !== "idle"}
              isDisabled={
                fetcher.state !== "idle" ||
                (attribute.type === "File" && !filePath)
              }
              rightIcon={<LuCircleCheck />}
              type="submit"
            >
              Record
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

export function DeleteStepRecordModal({
  onClose,
  id,
  title,
  description,
}: {
  onClose: () => void;
  id: string;
  title: string;
  description: string;
}) {
  const fetcher = useFetcher<{ success: boolean }>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data?.success, onClose]);

  return (
    <Modal open={true} onOpenChange={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription>{description}</ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <fetcher.Form method="post" action={path.to.recordDelete(id)}>
            <Button
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
              variant="destructive"
            >
              Delete
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
