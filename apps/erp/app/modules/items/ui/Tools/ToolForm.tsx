import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Loading,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  VStack,
  cn,
  supportedModelTypes,
  toast,
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload } from "react-icons/lu";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  DefaultMethodType,
  Hidden,
  Input,
  InputControlled,
  Number,
  Select,
  Submit,
  TextArea,
  UnitOfMeasure,
} from "~/components/Form";
import { ReplenishmentSystemIcon, TrackingTypeIcon } from "~/components/Icons";
import { useNextItemId, usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  itemReplenishmentSystems,
  itemTrackingTypes,
  toolValidator,
} from "../../items.models";

type ToolFormProps = {
  initialValues: z.infer<typeof toolValidator> & { tags: string[] };
  type?: "card" | "modal";
  onClose?: () => void;
};

const fileSizeLimitMb = 50;

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

const ToolForm = ({ initialValues, type = "card", onClose }: ToolFormProps) => {
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  const [modelUploadId, setModelUploadId] = useState<string | null>(null);
  const [modelIsUploading, setModelIsUploading] = useState(false);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const { carbon } = useCarbon();
  const {
    company: { id: companyId },
  } = useUser();

  const modelUpload = async (file: File) => {
    if (!carbon) return;
    flushSync(() => {
      setModelIsUploading(true);
    });

    const modelId = nanoid();
    const fileExtension = file.name.split(".").pop();
    const fileName = `${companyId}/models/${modelId}.${fileExtension}`;

    const [fileUpload, recordInsert] = await Promise.all([
      carbon.storage.from("private").upload(fileName, file),
      carbon.from("modelUpload").insert({
        id: modelId,
        modelPath: fileName,
        size: file.size,
        name: file.name,
        companyId: companyId,
        createdBy: "system",
      }),
    ]);

    if (fileUpload.error || recordInsert.error) {
      toast.error(`Failed to upload model`);
    } else {
      setModelUploadId(modelId);
      setModelFile(file);
      toast.success(`Uploaded model`);
    }

    setModelIsUploading(false);
  };

  const removeModel = () => {
    setModelUploadId(null);
    setModelFile(null);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    maxSize: fileSizeLimitMb * 1024 * 1024,
    onDropAccepted: async (acceptedFiles) => {
      const file = acceptedFiles[0];
      const fileSizeLimit = fileSizeLimitMb * 1024 * 1024;

      const fileExtension = file.name.split(".").pop()?.toLowerCase();
      if (!fileExtension || !supportedModelTypes.includes(fileExtension)) {
        toast.error("File type not supported");
        return;
      }

      if (file.size > fileSizeLimit) {
        toast.error(`File size too big (max. ${fileSizeLimitMb} MB)`);
        return;
      }

      await modelUpload(file);
    },
    onDropRejected: (fileRejections) => {
      const { errors } = fileRejections[0];
      let message;
      if (errors[0].code === "file-too-large") {
        message = `File size too big (max. ${fileSizeLimitMb} MB)`;
      } else if (errors[0].code === "file-invalid-type") {
        message = "File type not supported";
      } else {
        message = errors[0].message;
      }
      toast.error(message);
    },
  });

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created tool`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create tool: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const { id, onIdChange, loading } = useNextItemId("Tool");
  const permissions = usePermissions();
  const isEditing = !!initialValues.id;

  const itemTrackingTypeOptions = itemTrackingTypes.map((itemTrackingType) => ({
    label: (
      <span className="flex items-center gap-2">
        <TrackingTypeIcon type={itemTrackingType} />
        {itemTrackingType}
      </span>
    ),
    value: itemTrackingType,
  }));

  const [replenishmentSystem, setReplenishmentSystem] = useState<string>(
    initialValues.replenishmentSystem ?? "Buy"
  );
  const [defaultMethodType, setDefaultMethodType] = useState<string>(
    initialValues.defaultMethodType ?? "Buy"
  );
  const itemReplenishmentSystemOptions =
    itemReplenishmentSystems.map((itemReplenishmentSystem) => ({
      label: (
        <span className="flex items-center gap-2">
          <ReplenishmentSystemIcon type={itemReplenishmentSystem} />
          {itemReplenishmentSystem}
        </span>
      ),
      value: itemReplenishmentSystem,
    })) ?? [];

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardContent>
          <ValidatedForm
            action={isEditing ? undefined : path.to.newTool}
            method="post"
            validator={toolValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
          >
            <ModalCardHeader>
              <ModalCardTitle>
                {isEditing ? "Tool Details" : "New Tool"}
              </ModalCardTitle>
              {!isEditing && (
                <ModalCardDescription>
                  A tool is a physical item used to make a part that can be used
                  across multiple jobs
                </ModalCardDescription>
              )}
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="type" value={type} />
              <Hidden name="modelUploadId" value={modelUploadId ?? ""} />
              <div
                className={cn(
                  "grid w-full gap-x-8 gap-y-4",
                  isEditing
                    ? "grid-cols-1 md:grid-cols-3"
                    : "grid-cols-1 md:grid-cols-2"
                )}
              >
                {isEditing ? (
                  <Input name="id" label="Tool ID" isReadOnly />
                ) : (
                  <InputControlled
                    name="id"
                    label="Tool ID"
                    helperText={
                      startsWithLetter(id)
                        ? "Use ... to get the next tool ID"
                        : undefined
                    }
                    value={id}
                    onChange={onIdChange}
                    isDisabled={loading}
                    isUppercase
                    autoFocus
                  />
                )}
                <Input
                  name="revision"
                  label="Revision"
                  isReadOnly={isEditing}
                />

                <Input name="name" label="Short Description" />
                <Select
                  name="itemTrackingType"
                  label="Tracking Type"
                  options={itemTrackingTypeOptions}
                />
                {isEditing && (
                  <TextArea name="description" label="Long Description" />
                )}
                <Select
                  name="replenishmentSystem"
                  label="Replenishment System"
                  options={itemReplenishmentSystemOptions}
                  onChange={(newValue) => {
                    setReplenishmentSystem(newValue?.value ?? "Buy");
                    if (newValue?.value === "Buy") {
                      setDefaultMethodType("Buy");
                    } else {
                      setDefaultMethodType("Make");
                    }
                  }}
                />
                <DefaultMethodType
                  name="defaultMethodType"
                  label="Default Method Type"
                  replenishmentSystem={replenishmentSystem}
                  value={defaultMethodType}
                  onChange={(newValue) =>
                    setDefaultMethodType(newValue?.value ?? "Buy")
                  }
                />

                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label="Unit of Measure"
                />
                {!isEditing && (
                  <Number
                    name="unitCost"
                    label="Unit Cost"
                    formatOptions={{
                      style: "currency",
                      currency: baseCurrency,
                    }}
                    minValue={0}
                    isReadOnly={replenishmentSystem === "Make"}
                  />
                )}
                <Boolean name="active" label="Active" />

                <CustomFormFields table="tool" tags={initialValues.tags} />
              </div>
              <VStack spacing={2} className="mt-4 w-full">
                <label
                  htmlFor="model-upload"
                  className="text-xs font-medium text-muted-foreground"
                >
                  CAD Model
                </label>
                <div
                  {...getRootProps()}
                  className={`w-full border-2 border-dashed rounded-md p-6 text-center hover:border-primary hover:bg-primary/10 cursor-pointer ${
                    isDragActive
                      ? "border-primary bg-primary/10"
                      : "border-muted"
                  }`}
                >
                  <input id="model-upload" {...getInputProps()} />
                  {modelFile ? (
                    <>
                      <p className="text-sm font-semibold text-card-foreground">
                        {modelFile.name}
                      </p>
                      <p className="text-xs text-muted-foreground group-hover:text-foreground">
                        {convertKbToString(Math.ceil(modelFile.size / 1024))}
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-2"
                        onClick={removeModel}
                      >
                        Remove
                      </Button>
                    </>
                  ) : (
                    <Loading isLoading={modelIsUploading}>
                      <LuCloudUpload className="mx-auto h-12 w-12 text-muted-foreground group-hover:text-primary-foreground" />
                      <p className="text-xs text-muted-foreground group-hover:text-foreground">
                        Supports {supportedModelTypes.join(", ")} files
                      </p>
                    </Loading>
                  )}
                </div>
              </VStack>
            </ModalCardBody>
            <ModalCardFooter>
              <Submit
                isLoading={fetcher.state !== "idle"}
                isDisabled={
                  isEditing
                    ? !permissions.can("update", "parts")
                    : !permissions.can("create", "parts")
                }
              >
                Save
              </Submit>
            </ModalCardFooter>
          </ValidatedForm>
        </ModalCardContent>
      </ModalCard>
    </ModalCardProvider>
  );
};

export default ToolForm;
