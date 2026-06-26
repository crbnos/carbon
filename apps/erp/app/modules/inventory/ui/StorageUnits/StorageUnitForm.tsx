import { ValidatedForm } from "@carbon/form";
import {
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Input as InputBase,
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
import { PrintButton } from "~/components";
import {
  Hidden,
  Input,
  Location,
  StorageTypes,
  Submit,
  WorkCenter
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { storageUnitValidator } from "~/modules/inventory";
import { path } from "~/utils/path";
import { StorageUnitParentSelect } from "./StorageUnitParentSelect";

type StorageUnitFormProps = {
  locationId: string;
  initialValues: z.infer<typeof storageUnitValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
  inheritedWorkCenter?: {
    workCenterId: string;
    workCenterName: string | null;
  } | null;
};

const StorageUnitForm = ({
  locationId,
  initialValues,
  open = true,
  type = "drawer",
  onClose,
  inheritedWorkCenter
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
                <StorageUnitParentSelect
                  name="parentId"
                  label={t`Parent Storage Unit`}
                  termId="storage-unit-parent"
                  locationId={locationId}
                  isOptional
                  helperText={t`Must be in the same location`}
                  excludeDescendantsOf={initialValues.id}
                />
                <StorageTypes
                  name="storageTypeIds"
                  label={t`Storage Types`}
                  termId="storage-unit-storage-types"
                  isOptional
                />
                {inheritedWorkCenter ? (
                  <FormControl>
                    <FormLabel htmlFor="workCenterId-inherited">
                      {t`Work Center`}
                    </FormLabel>
                    <InputBase
                      id="workCenterId-inherited"
                      value={inheritedWorkCenter.workCenterName ?? t`Unknown`}
                      isReadOnly
                      className="text-muted-foreground"
                    />
                    <FormHelperText>{t`Inherited from parent`}</FormHelperText>
                  </FormControl>
                ) : (
                  <WorkCenter
                    name="workCenterId"
                    label={t`Work Center`}
                    termId="storage-unit-work-center"
                    locationId={locationId}
                    isOptional
                    helperText={t`Assigns this storage unit to a work center (lineside)`}
                  />
                )}
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
                {isEditing && initialValues.id && (
                  <PrintButton
                    sourceDocument="StorageUnit"
                    sourceDocumentId={initialValues.id}
                    locationId={locationId || undefined}
                    context="inventory"
                    fileRoutes={{
                      pdf: (id: string, opts?: { labelSize?: string }) =>
                        path.to.file.storageUnitLabelsPdf(id, opts),
                      zpl: (id: string, opts?: { labelSize?: string }) =>
                        path.to.file.storageUnitLabelsZpl(id, opts)
                    }}
                  />
                )}
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default StorageUnitForm;
