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
import { useEffect, useState } from "react";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Customer,
  DefaultMethodType,
  Hidden,
  Input,
  InputControlled,
  Select,
  Submit,
  TextArea,
} from "~/components/Form";
import { useNextItemId, usePermissions } from "~/hooks";
import {
  fixtureValidator,
  itemReplenishmentSystems,
  itemTrackingTypes,
} from "~/modules/items";
import { path } from "~/utils/path";

type FixtureFormProps = {
  initialValues: z.infer<typeof fixtureValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

const FixtureForm = ({
  initialValues,
  type = "card",
  onClose,
}: FixtureFormProps) => {
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created fixture`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(`Failed to create fixture: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const { id, onIdChange, loading } = useNextItemId("Fixture");
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
            action={isEditing ? undefined : path.to.newFixture}
            method="post"
            validator={fixtureValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
          >
            <ModalCardHeader>
              <ModalCardTitle>
                {isEditing ? "Fixture Details" : "New Fixture"}
              </ModalCardTitle>
              {!isEditing && (
                <ModalCardDescription>
                  A fixture is a physical item used to make a part that can be
                  used across multiple jobs
                </ModalCardDescription>
              )}
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="type" value={type} />
              <Hidden name="unitOfMeasureCode" value="EA" />

              <div
                className={cn(
                  "grid w-full gap-x-8 gap-y-4",
                  isEditing ? "grid-cols-1 md:grid-cols-3" : "grid-cols-2"
                )}
              >
                {isEditing ? (
                  <Input name="id" label="Fixture ID" isReadOnly />
                ) : (
                  <InputControlled
                    name="id"
                    label="Fixture ID"
                    helperText={
                      startsWithLetter(id)
                        ? "Use ... to get the next fixture ID"
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
                  name="itemTrackingType"
                  label="Tracking Type"
                  options={itemTrackingTypeOptions}
                />
                {isEditing && (
                  <TextArea name="description" label="Description" />
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

                <Customer name="customerId" label="Customer" />
                <Boolean name="active" label="Active" />

                <CustomFormFields table="fixture" />
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

export default FixtureForm;
