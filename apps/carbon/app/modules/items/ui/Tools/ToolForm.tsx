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
import {
  Boolean,
  CustomFormFields,
  DefaultMethodType,
  Hidden,
  Input,
  InputControlled,
  Select,
  Submit,
  TextArea,
  UnitOfMeasure,
} from "~/components/Form";
import { useNextItemId, usePermissions } from "~/hooks";
import { itemTrackingTypes, toolValidator } from "~/modules/items";
import { path } from "~/utils/path";

type ToolFormProps = {
  initialValues: z.infer<typeof toolValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

const ToolForm = ({ initialValues, type = "card", onClose }: ToolFormProps) => {
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

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

  const itemTrackingTypeOptions =
    itemTrackingTypes.map((itemTrackingType) => ({
      label: itemTrackingType,
      value: itemTrackingType,
    })) ?? [];

  const [defaultMethodType, setDefaultMethodType] = useState<string>(
    initialValues.defaultMethodType ?? "Buy"
  );

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
              <Hidden name="replenishmentSystem" value="Buy" />
              <div
                className={cn(
                  "grid w-full gap-x-8 gap-y-4",
                  isEditing ? "grid-cols-1 md:grid-cols-3" : "grid-cols-2"
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

                <Input name="name" label="Name" />
                <Select
                  name="itemTrackingType"
                  label="Tracking Type"
                  options={itemTrackingTypeOptions}
                />
                {isEditing && (
                  <TextArea name="description" label="Description" />
                )}

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

                <Boolean name="active" label="Active" />

                <CustomFormFields table="tool" />
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

export default ToolForm;
