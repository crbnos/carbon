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
import {
  itemInventoryTypes,
  partReplenishmentSystems,
  partValidator,
} from "~/modules/items";
import { path } from "~/utils/path";

type PartFormProps = {
  initialValues: z.infer<typeof partValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

const PartForm = ({ initialValues, type = "card", onClose }: PartFormProps) => {
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created part`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create part: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const { id, onIdChange, loading } = useNextItemId("part");
  const permissions = usePermissions();
  const isEditing = !!initialValues.id;

  const itemInventoryTypeOptions =
    itemInventoryTypes.map((itemInventoryType) => ({
      label: itemInventoryType,
      value: itemInventoryType,
    })) ?? [];

  const partReplenishmentSystemOptions =
    partReplenishmentSystems.map((partReplenishmentSystem) => ({
      label: partReplenishmentSystem,
      value: partReplenishmentSystem,
    })) ?? [];

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardContent>
          <ValidatedForm
            action={isEditing ? undefined : path.to.newPart}
            method="post"
            validator={partValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
          >
            <ModalCardHeader>
              <ModalCardTitle>
                {isEditing ? "Part Details" : "New Part"}
              </ModalCardTitle>
              {!isEditing && (
                <ModalCardDescription>
                  A part contains the information about a specific item that can
                  be purchased or manufactured.
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
                  <Input name="id" label="Part ID" isReadOnly />
                ) : (
                  <InputControlled
                    name="id"
                    label="Part ID"
                    helperText={
                      startsWithLetter(id)
                        ? "Use ... to get the next part ID"
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
                  name="replenishmentSystem"
                  label="Replenishment System"
                  options={partReplenishmentSystemOptions}
                />
                <Select
                  name="itemInventoryType"
                  label="Part Type"
                  options={itemInventoryTypeOptions}
                />
                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label="Unit of Measure"
                />

                <Boolean name="blocked" label="Blocked" />
                {isEditing && <Boolean name="active" label="Active" />}

                <CustomFormFields table="part" />
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

export default PartForm;
