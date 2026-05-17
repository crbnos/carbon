import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  cn,
  Loading,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  toast,
  VStack
} from "@carbon/react";
import {
  convertKbToString,
  getCompanyPrivateBucket,
  getFileSizeLimit,
  supportedModelTypes
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload } from "react-icons/lu";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  DefaultMethodType,
  Hidden,
  Input,
  InputControlled,
  ItemPostingGroup,
  Number,
  Select,
  Submit,
  UnitOfMeasure
} from "~/components/Form";
import { ReplenishmentSystemIcon, TrackingTypeIcon } from "~/components/Icons";
import { useNextItemId, usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  itemReplenishmentSystems,
  itemTrackingTypes,
  toolValidator
} from "../../items.models";
import ItemStorageFields from "../Item/ItemStorageFields";

type ToolFormProps = {
  initialValues: z.infer<typeof toolValidator> & { tags: string[] };
  type?: "card" | "modal";
  onClose?: () => void;
};

const SIZE_LIMIT = getFileSizeLimit("CAD_MODEL_UPLOAD");

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

const ToolForm = ({ initialValues, type = "card", onClose }: ToolFormProps) => {
  const { t } = useLingui();
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  const [modelUploadId, setModelUploadId] = useState<string | null>(null);
  const [modelIsUploading, setModelIsUploading] = useState(false);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();
  const companyPrivateBucket = getCompanyPrivateBucket(companyId);

  const modelUpload = async (file: File) => {
    if (!carbon) return;
    flushSync(() => {
      setModelIsUploading(true);
    });

    const modelId = nanoid();
    const fileExtension = file.name.split(".").pop();
    const fileName = `${companyId}/models/${modelId}.${fileExtension}`;

    const [fileUpload, recordInsert] = await Promise.all([
      carbon.storage.from(companyPrivateBucket).upload(fileName, file),
      carbon.from("modelUpload").insert({
        id: modelId,
        modelPath: fileName,
        size: file.size,
        name: file.name,
        companyId: companyId,
        createdBy: "system"
      })
    ]);

    if (fileUpload.error || recordInsert.error) {
      toast.error(t`Failed to upload model`);
    } else {
      setModelUploadId(modelId);
      setModelFile(file);
      toast.success(t`Uploaded model`);
    }

    setModelIsUploading(false);
  };

  const removeModel = () => {
    setModelUploadId(null);
    setModelFile(null);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    maxSize: SIZE_LIMIT.bytes,
    onDropAccepted: async (acceptedFiles) => {
      const file = acceptedFiles[0];

      const fileExtension = file.name.split(".").pop()?.toLowerCase();
      if (!fileExtension || !supportedModelTypes.includes(fileExtension)) {
        toast.error(t`File type not supported`);
        return;
      }

      if (file.size > SIZE_LIMIT.bytes) {
        toast.error(t`File size too big (max. ${SIZE_LIMIT.format()})`);
        return;
      }

      await modelUpload(file);
    },
    onDropRejected: (fileRejections) => {
      const { errors } = fileRejections[0];
      let message;
      if (errors[0].code === "file-too-large") {
        message = t`File size too big (max. ${SIZE_LIMIT.format()})`;
      } else if (errors[0].code === "file-invalid-type") {
        message = t`File type not supported`;
      } else {
        message = errors[0].message;
      }
      toast.error(message);
    }
  });

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(t`Created tool`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(t`Failed to create tool: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type, t]);

  const { id, onIdChange, loading } = useNextItemId("Tool");
  const permissions = usePermissions();
  const isEditing = !!initialValues.id;

  const translateItemTrackingType = (v: string) =>
    v === "Inventory"
      ? t`Inventory`
      : v === "Non-Inventory"
        ? t`Non-Inventory`
        : v === "Serial"
          ? t`Serial`
          : t`Batch`;

  const itemTrackingTypeOptions = itemTrackingTypes.map((itemTrackingType) => ({
    label: (
      <span className="flex items-center gap-2">
        <TrackingTypeIcon type={itemTrackingType} />
        {translateItemTrackingType(itemTrackingType)}
      </span>
    ),
    value: itemTrackingType
  }));

  const [replenishmentSystem, setReplenishmentSystem] = useState<string>(
    initialValues.replenishmentSystem ?? "Buy"
  );
  const [defaultMethodType, setDefaultMethodType] = useState<string>(
    initialValues.defaultMethodType ?? "Purchase to Order"
  );
  const itemReplenishmentSystemOptions =
    itemReplenishmentSystems.map((itemReplenishmentSystem) => ({
      label: (
        <span className="flex items-center gap-2">
          <ReplenishmentSystemIcon type={itemReplenishmentSystem} />
          {itemReplenishmentSystem === "Buy"
            ? t`Buy`
            : itemReplenishmentSystem === "Make"
              ? t`Make`
              : t`Buy and Make`}
        </span>
      ),
      value: itemReplenishmentSystem
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
                {isEditing ? (
                  <Trans>Tool Details</Trans>
                ) : (
                  <Trans>New Tool</Trans>
                )}
              </ModalCardTitle>
              {!isEditing && (
                <ModalCardDescription>
                  <Trans>
                    A tool is a physical item used to make a part that can be
                    used across multiple jobs
                  </Trans>
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
                  <Input name="id" label={t`Tool ID`} isReadOnly />
                ) : (
                  <InputControlled
                    name="id"
                    label={t`Tool ID`}
                    helperText={
                      startsWithLetter(id)
                        ? t`Use ... to get the next tool ID`
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
                  label={t`Revision`}
                  isReadOnly={isEditing}
                />

                <Input name="name" label={t`Short Description`} />

                <Select
                  name="replenishmentSystem"
                  label={t`Replenishment System`}
                  options={itemReplenishmentSystemOptions}
                  onChange={(newValue) => {
                    setReplenishmentSystem(newValue?.value ?? "Buy");
                    if (newValue?.value === "Buy") {
                      setDefaultMethodType("Purchase to Order");
                    } else {
                      setDefaultMethodType("Make to Order");
                    }
                  }}
                />
                <Select
                  name="itemTrackingType"
                  label={t`Tracking Type`}
                  options={itemTrackingTypeOptions}
                />
                <DefaultMethodType
                  name="defaultMethodType"
                  label={t`Default Method Type`}
                  replenishmentSystem={replenishmentSystem}
                  value={defaultMethodType}
                  onChange={(newValue) =>
                    setDefaultMethodType(newValue?.value ?? "Purchase to Order")
                  }
                />

                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label={t`Unit of Measure`}
                />
                {!isEditing && (
                  <ItemPostingGroup
                    name="postingGroupId"
                    label={t`Item Group`}
                    isClearable
                  />
                )}
                {!isEditing && (
                  <Number
                    name="unitCost"
                    label={t`Unit Cost`}
                    formatOptions={{
                      style: "currency",
                      currency: baseCurrency
                    }}
                    minValue={0}
                    isReadOnly={replenishmentSystem === "Make"}
                  />
                )}

                <ItemStorageFields />

                <CustomFormFields table="tool" tags={initialValues.tags} />
              </div>
              <VStack spacing={2} className="mt-4 w-full">
                <label
                  htmlFor="model-upload"
                  className="text-xs font-medium text-muted-foreground"
                >
                  <Trans>CAD Model</Trans>
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
                        <Trans>Remove</Trans>
                      </Button>
                    </>
                  ) : (
                    <Loading isLoading={modelIsUploading}>
                      <LuCloudUpload className="mx-auto h-12 w-12 text-muted-foreground group-hover:text-primary-foreground" />
                      <p className="text-xs text-muted-foreground group-hover:text-foreground">
                        {t`Supports ${supportedModelTypes.join(", ")} files`}
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
                <Trans>Save</Trans>
              </Submit>
            </ModalCardFooter>
          </ValidatedForm>
        </ModalCardContent>
      </ModalCard>
    </ModalCardProvider>
  );
};

export default ToolForm;
