import { ValidatedForm } from "@carbon/form";
import {
  cn,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  InputControlled,
  ItemPostingGroup,
  Select,
  Submit,
  TextArea,
  UnitOfMeasure
} from "~/components/Form";
import { ReplenishmentSystemIcon } from "~/components/Icons";
import { useNextItemId, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  serviceReplenishmentSystems,
  serviceValidator
} from "../../items.models";

type ServiceFormProps = {
  initialValues: z.infer<typeof serviceValidator> & { tags: string[] };
  type?: "card" | "modal";
  onClose?: () => void;
};

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

const ServiceForm = ({
  initialValues,
  type = "card",
  onClose
}: ServiceFormProps) => {
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();
  const { t } = useLingui();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(t`Created service`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(t`Failed to create service: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type, t]);

  const { id, onIdChange, loading } = useNextItemId("Service");
  const permissions = usePermissions();
  const isEditing = !!initialValues.id;

  const [replenishmentSystem, setReplenishmentSystem] = useState<string>(
    initialValues.replenishmentSystem ?? "Buy"
  );
  // Services are Non-Inventory, so the method type is fully determined by the
  // replenishment system — never "Pull from Inventory".
  const defaultMethodType =
    replenishmentSystem === "Make" ? "Make to Order" : "Purchase to Order";

  const itemReplenishmentSystemOptions = serviceReplenishmentSystems.map(
    (itemReplenishmentSystem) => ({
      label: (
        <span className="flex items-center gap-2">
          <ReplenishmentSystemIcon type={itemReplenishmentSystem} />
          {itemReplenishmentSystem === "Buy" ? t`Buy` : t`Make`}
        </span>
      ),
      value: itemReplenishmentSystem
    })
  );

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardContent>
          <ValidatedForm
            action={isEditing ? undefined : path.to.newService}
            method="post"
            validator={serviceValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
          >
            <ModalCardHeader>
              <ModalCardTitle>
                {isEditing ? t`Service Details` : t`New Service`}
              </ModalCardTitle>
              {!isEditing && (
                <ModalCardDescription>
                  {t`A service is a billable activity that is bought or performed — it is never shipped, received, or stocked`}
                </ModalCardDescription>
              )}
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="type" value={type} />
              <Hidden name="itemTrackingType" value="Non-Inventory" />
              <Hidden name="defaultMethodType" value={defaultMethodType} />
              <div
                className={cn(
                  "grid w-full gap-x-8 gap-y-4",
                  isEditing
                    ? "grid-cols-1 md:grid-cols-3"
                    : "grid-cols-1 md:grid-cols-2"
                )}
              >
                {isEditing ? (
                  <Input name="id" label={t`Service ID`} isReadOnly />
                ) : (
                  <InputControlled
                    name="id"
                    label={t`Service ID`}
                    helperText={
                      startsWithLetter(id)
                        ? t`Use ... to get the next service ID`
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

                <Input
                  name="name"
                  label={t`Short Description`}
                  characterLimit={40}
                />
                <Select
                  name="replenishmentSystem"
                  label={t`Replenishment System`}
                  termId="replenishment-system"
                  options={itemReplenishmentSystemOptions}
                  onChange={(newValue) =>
                    setReplenishmentSystem(newValue?.value ?? "Buy")
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
                    termId="item-group"
                    isClearable
                  />
                )}
                <CustomFormFields table="service" tags={initialValues.tags} />
              </div>
              <div className="mt-4 w-full">
                <TextArea name="description" label={t`Long Description`} />
              </div>
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

export default ServiceForm;
