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
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { TrackingTypeIcon } from "~/components";
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
import Shape from "~/components/Form/Shape";
import Substance from "~/components/Form/Substance";
import { useNextItemId, usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { itemTrackingTypes, materialValidator } from "../../items.models";

type MaterialFormProps = {
  initialValues: z.infer<typeof materialValidator> & { tags?: string[] };
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
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode;

  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

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
      label: (
        <span className="flex items-center gap-2">
          <TrackingTypeIcon type={itemTrackingType} />
          {itemTrackingType}
        </span>
      ),
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
                  isEditing
                    ? "grid-cols-1 md:grid-cols-3"
                    : "grid-cols-1 md:grid-cols-2"
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
                <Substance name="materialSubstanceId" label="Substance" />
                {isEditing && (
                  <TextArea name="description" label="Long Description" />
                )}
                <Shape name="materialFormId" label="Form" />
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
                      currency: baseCurrency,
                    }}
                    minValue={0}
                  />
                )}
                <Boolean name="active" label="Active" />
                <CustomFormFields table="material" tags={initialValues.tags} />
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
