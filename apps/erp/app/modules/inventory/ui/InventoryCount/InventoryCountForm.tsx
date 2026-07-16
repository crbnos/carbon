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
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Boolean,
  Location,
  Select,
  StorageUnit,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  inventoryCountValidator,
  inventoryItemTypes
} from "~/modules/inventory";
import { path } from "~/utils/path";

type InventoryCountFormProps = {
  initialValues: z.infer<typeof inventoryCountValidator>;
  onClose: () => void;
};

const InventoryCountForm = ({
  initialValues,
  onClose
}: InventoryCountFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();

  const [locationId, setLocationId] = useState(initialValues.locationId ?? "");

  const itemTypeOptions = inventoryItemTypes.map((type) => ({
    label: type,
    value: type
  }));

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={inventoryCountValidator}
            method="post"
            action={path.to.newInventoryCount}
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>{t`New Inventory Count`}</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <Location
                  name="locationId"
                  label={t`Location`}
                  onChange={(location) => setLocationId(location?.value ?? "")}
                />
                <StorageUnit
                  name="storageUnitIds"
                  label={t`Storage Unit (optional)`}
                  locationId={locationId}
                />
                <Select
                  name="itemType"
                  label={t`Item Type (optional)`}
                  options={itemTypeOptions}
                  placeholder={t`All item types`}
                />
                <Boolean
                  name="isBlind"
                  label={t`Blind Count`}
                  description={t`Hide system quantities until the review step`}
                />
                <TextArea name="notes" label={t`Notes`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit
                  isDisabled={!permissions.can("create", "inventory")}
                  isLoading={fetcher.state !== "idle"}
                >
                  {t`Create & Snapshot`}
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  {t`Cancel`}
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default InventoryCountForm;
