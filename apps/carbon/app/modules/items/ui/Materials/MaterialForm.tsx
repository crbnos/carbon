import { ValidatedForm } from "@carbon/form";
import {
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  cn,
  toast,
  useMount,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  Combobox,
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
import { useNextItemId, usePermissions, useRouteData } from "~/hooks";
import type {
  getMaterialFormsList,
  getMaterialSubstancesList,
} from "~/modules/items";
import { itemTrackingTypes, materialValidator } from "~/modules/items";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type MaterialFormProps = {
  initialValues: z.infer<typeof materialValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

const MaterialForm = ({
  initialValues,
  type = "card",
  onClose,
}: MaterialFormProps) => {
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();
  const forms = useMaterialForms();
  const substances = useMaterialSubstances();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created material`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create material: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const { id, onIdChange, loading } = useNextItemId("Material");
  const permissions = usePermissions();
  const isEditing = !!initialValues.id;

  const [defaultMethodType, setDefaultMethodType] = useState<string>(
    initialValues.defaultMethodType ?? "Buy"
  );

  const itemTrackingTypeOptions =
    itemTrackingTypes.map((itemTrackingType) => ({
      label: itemTrackingType,
      value: itemTrackingType,
    })) ?? [];

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardContent>
          <ValidatedForm
            action={isEditing ? undefined : path.to.newMaterial}
            method="post"
            validator={materialValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
          >
            <ModalCardHeader>
              <ModalCardTitle>
                {isEditing ? "Material Details" : "New Material"}
              </ModalCardTitle>
              {!isEditing && (
                <ModalCardDescription>
                  A material is a physical item used to make a part that can be
                  used across multiple jobs
                </ModalCardDescription>
              )}
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="type" value={type} />
              <Hidden name="replenishmentSystem" value="Buy" />
              <div
                className={cn(
                  "grid w-full gap-x-8 gap-y-4",
                  isEditing ? "grid-cols-1 md:grid-cols-3" : "grid-cols-2"
                )}
              >
                {isEditing ? (
                  <Input name="id" label="Material ID" isReadOnly />
                ) : (
                  <InputControlled
                    name="id"
                    label="Material ID"
                    helperText={
                      startsWithLetter(id)
                        ? "Use ... to get the next material ID"
                        : undefined
                    }
                    value={id}
                    onChange={onIdChange}
                    isDisabled={loading}
                    isUppercase
                    autoFocus
                  />
                )}

                <Input name="name" label="Short Description" />
                <Combobox
                  name="materialSubstanceId"
                  label="Substance"
                  options={substances}
                />
                {isEditing && (
                  <TextArea name="description" label="Long Description" />
                )}
                <Combobox name="materialFormId" label="Form" options={forms} />
                <Input name="finish" label="Finish" />
                <Input name="grade" label="Grade" />
                <Input name="dimensions" label="Dimensions" />

                <Select
                  name="itemTrackingType"
                  label="Tracking Type"
                  options={itemTrackingTypeOptions}
                />

                <DefaultMethodType
                  name="defaultMethodType"
                  label="Default Method Type"
                  replenishmentSystem="Buy"
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
                      currency: "USD",
                    }}
                    minValue={0}
                  />
                )}
                <Boolean name="active" label="Active" />
                <CustomFormFields table="material" />
              </div>
            </ModalCardBody>
            <ModalCardFooter>
              <Submit
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

export default MaterialForm;

export const useMaterialForms = () => {
  const formsFetcher =
    useFetcher<Awaited<ReturnType<typeof getMaterialFormsList>>>();

  const sharedPartData = useRouteData<{
    forms: ListItem[];
  }>(path.to.materialRoot);

  const hasSharedPartData = sharedPartData?.forms?.length;

  useMount(() => {
    if (!hasSharedPartData) formsFetcher.load(path.to.api.materialForms);
  });

  const options = useMemo(() => {
    const dataSource =
      (hasSharedPartData ? sharedPartData?.forms : formsFetcher.data?.data) ??
      [];

    return dataSource.map((f) => ({
      value: f.id,
      label: f.name,
    }));
  }, [hasSharedPartData, sharedPartData?.forms, formsFetcher.data?.data]);

  return options;
};

export const useMaterialSubstances = () => {
  const substancesFetcher =
    useFetcher<Awaited<ReturnType<typeof getMaterialSubstancesList>>>();

  const sharedPartData = useRouteData<{
    substances: ListItem[];
  }>(path.to.materialRoot);

  const hasSharedPartData = sharedPartData?.substances?.length;

  useMount(() => {
    if (!hasSharedPartData)
      substancesFetcher.load(path.to.api.materialSubstances);
  });

  const options = useMemo(() => {
    const dataSource =
      (hasSharedPartData
        ? sharedPartData?.substances
        : substancesFetcher.data?.data) ?? [];

    return dataSource.map((s) => ({
      value: s.id,
      label: s.name,
    }));
  }, [
    hasSharedPartData,
    sharedPartData?.substances,
    substancesFetcher.data?.data,
  ]);

  return options;
};
