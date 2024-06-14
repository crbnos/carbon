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
import { consumableValidator, itemInventoryTypes } from "~/modules/items";
import { path } from "~/utils/path";

type ConsumableFormProps = {
  initialValues: z.infer<typeof consumableValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

const ConsumableForm = ({
  initialValues,
  type = "card",
  onClose,
}: ConsumableFormProps) => {
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created consumable`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create consumable: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const { id, onIdChange, loading } = useNextItemId("Consumable");
  const permissions = usePermissions();
  const isEditing = !!initialValues.id;

  const itemInventoryTypeOptions =
    itemInventoryTypes.map((itemInventoryType) => ({
      label: itemInventoryType,
      value: itemInventoryType,
    })) ?? [];

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardContent>
          <ValidatedForm
            action={isEditing ? undefined : path.to.newConsumable}
            method="post"
            validator={consumableValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
          >
            <ModalCardHeader>
              <ModalCardTitle>
                {isEditing ? "Consumable Details" : "New Consumable"}
              </ModalCardTitle>
              {!isEditing && (
                <ModalCardDescription>
                  A consumable is a physical item used to make a part that can
                  be used across multiple jobs
                </ModalCardDescription>
              )}
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="type" value={type} />
              <div
                className={cn(
                  "grid w-full gap-x-8 gap-y-2",
                  isEditing ? "grid-cols-1 md:grid-cols-3" : "grid-cols-2"
                )}
              >
                {isEditing ? (
                  <Input name="id" label="Consumable ID" isReadOnly />
                ) : (
                  <InputControlled
                    name="id"
                    label="Consumable ID"
                    helperText={
                      startsWithLetter(id)
                        ? "Use ... to get the next consumable ID"
                        : undefined
                    }
                    value={id}
                    onChange={onIdChange}
                    isDisabled={loading}
                    autoFocus
                  />
                )}

                <Input name="name" label="Name" />
                <ItemGroup name="itemGroupId" label="Posting Group" />
                {isEditing && (
                  <TextArea name="description" label="Description" />
                )}

                <Select
                  name="itemInventoryType"
                  label="Consumable Type"
                  options={itemInventoryTypeOptions}
                />
                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label="Unit of Measure"
                />

                <Boolean name="blocked" label="Blocked" />
                {isEditing && <Boolean name="active" label="Active" />}

                <CustomFormFields table="consumable" />
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

export default ConsumableForm;
