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
import { ValidatedForm } from "@carbon/remix-validated-form";
import { useFetcher } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Input,
  InputControlled,
  ItemGroup,
  Select,
  Submit,
  TextArea,
  UnitOfMeasure,
} from "~/components/Form";
import { useNextItemId, usePermissions } from "~/hooks";
import { itemInventoryTypes, materialValidator } from "~/modules/items";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type MaterialFormProps = {
  initialValues: z.infer<typeof materialValidator>;
  substances: ListItem[];
  forms: ListItem[];
  type?: "card" | "modal";
  onClose?: () => void;
};

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

const MaterialForm = ({
  initialValues,
  type = "card",
  substances,
  forms,
  onClose,
}: MaterialFormProps) => {
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

  const itemInventoryTypeOptions =
    itemInventoryTypes.map((itemInventoryType) => ({
      label: itemInventoryType,
      value: itemInventoryType,
    })) ?? [];

  const substanceOptions = substances.map((substance) => ({
    label: substance.name,
    value: substance.id,
  }));

  const formOptions = forms.map((form) => ({
    label: form.name,
    value: form.id,
  }));

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
              <div
                className={cn(
                  "grid w-full gap-x-8 gap-y-2",
                  isEditing ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1"
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
                    autoFocus
                  />
                )}

                <Input name="name" label="Name" />
                <Select
                  name="materialSubstanceId"
                  label="Substance"
                  options={substanceOptions}
                />
                <Select
                  name="materialFormId"
                  label="Form"
                  options={formOptions}
                />
                <Input name="finish" label="Finish" />
                <Input name="grade" label="Grade" />
                <Input name="dimensions" label="Dimensions" />
                <ItemGroup name="itemGroupId" label="Posting Group" />
                {isEditing && (
                  <TextArea name="description" label="Description" />
                )}

                <Select
                  name="itemInventoryType"
                  label="Material Type"
                  options={itemInventoryTypeOptions}
                />
                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label="Unit of Measure"
                />

                <Boolean name="blocked" label="Blocked" />
                {isEditing && <Boolean name="active" label="Active" />}

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
