import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Hidden,
  Input,
  Location,
  StorageTypes,
  StorageUnit,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { storageUnitValidator } from "~/modules/inventory";
import { path } from "~/utils/path";

type StorageUnitFormProps = {
  locationId: string;
  initialValues: z.infer<typeof storageUnitValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const StorageUnitForm = ({
  locationId,
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: StorageUnitFormProps) => {
  const fetcher = useFetcher<{}>();
  const { t } = useLingui();

  const permissions = usePermissions();
  const isEditing = !!initialValues?.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={storageUnitValidator}
            method="post"
            action={
              isEditing
                ? path.to.storageUnit(initialValues.id!)
                : path.to.newStorageUnit
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            onSubmit={() => {
              if (type === "modal") {
                onClose?.();
              }
            }}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? t`Edit Storage Unit` : t`New Storage Unit`}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />

              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Location
                  isReadOnly={isEditing}
                  name="locationId"
                  label={t`Location`}
                />
                <StorageUnit
                  name="parentId"
                  label={t`Parent Storage Unit`}
                  locationId={locationId}
                  isOptional
                  helperText={t`Must be in the same location`}
                  excludeDescendantsOf={initialValues.id}
                />
                <StorageTypes
                  name="storageTypeIds"
                  label={t`Storage Types`}
                  isOptional
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default StorageUnitForm;
