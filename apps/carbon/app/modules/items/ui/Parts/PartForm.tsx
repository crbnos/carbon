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
  Number,
  Select,
  Submit,
  TextArea,
  UnitOfMeasure,
} from "~/components/Form";
import { useNextItemId, usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";
import {
  itemReplenishmentSystems,
  itemTrackingTypes,
  partValidator,
} from "../../items.models";

type PartFormProps = {
  initialValues: z.infer<typeof partValidator> & { tags?: string[] };
  type?: "card" | "modal";
  onClose?: () => void;
};

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

const PartForm = ({ initialValues, type = "card", onClose }: PartFormProps) => {
  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

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

  const { id, onIdChange, loading } = useNextItemId("Part");
  const permissions = usePermissions();
  const isEditing = !!initialValues.id;

  const itemTrackingTypeOptions =
    itemTrackingTypes.map((itemTrackingType) => ({
      label: itemTrackingType,
      value: itemTrackingType,
    })) ?? [];

  const [replenishmentSystem, setReplenishmentSystem] = useState<string>(
    initialValues.replenishmentSystem ?? "Buy"
  );
  const [defaultMethodType, setDefaultMethodType] = useState<string>(
    initialValues.defaultMethodType ?? "Buy"
  );
  const itemReplenishmentSystemOptions =
    itemReplenishmentSystems.map((itemReplenishmentSystem) => ({
      label: itemReplenishmentSystem,
      value: itemReplenishmentSystem,
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
                  "grid w-full gap-x-8 gap-y-4",
                  isEditing
                    ? "grid-cols-1 md:grid-cols-3"
                    : "grid-cols-1 md:grid-cols-2"
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
                    isUppercase
                  />
                )}

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
                  />
                )}
                <Boolean name="active" label="Active" />
                <CustomFormFields table="part" tags={initialValues.tags} />
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
