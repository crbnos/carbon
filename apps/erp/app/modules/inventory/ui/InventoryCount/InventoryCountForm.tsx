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
  MaterialType,
  Select,
  StorageTypes,
  StorageUnits,
  Submit,
  Tags,
  TextArea
} from "~/components/Form";
import MaterialDimension from "~/components/Form/MaterialDimension";
import MaterialFinish from "~/components/Form/MaterialFinish";
import MaterialGrade from "~/components/Form/MaterialGrade";
import Shape from "~/components/Form/Shape";
import Substance from "~/components/Form/Substance";
import { usePermissions } from "~/hooks";
import {
  inventoryCountValidator,
  inventoryItemTypes
} from "~/modules/inventory";
import { path } from "~/utils/path";

type InventoryCountFormProps = {
  initialValues: z.infer<typeof inventoryCountValidator>;
  availableTags: { name: string }[];
  onClose: () => void;
};

const InventoryCountForm = ({
  initialValues,
  availableTags,
  onClose
}: InventoryCountFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();

  const [locationId, setLocationId] = useState(initialValues.locationId ?? "");
  // Drive the material cascade: finish/grade/type narrow by substance,
  // dimension/type narrow by shape.
  const [substanceId, setSubstanceId] = useState(
    initialValues.materialSubstanceId ?? ""
  );
  const [formId, setFormId] = useState(initialValues.materialFormId ?? "");

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
                <StorageUnits
                  name="storageUnitIds"
                  label={t`Storage Units`}
                  locationId={locationId}
                  helperText={t`Selecting a parent also counts everything inside it`}
                />
                <StorageTypes name="storageTypeIds" label={t`Storage Types`} />
                <Select
                  name="itemType"
                  label={t`Item Type`}
                  options={itemTypeOptions}
                  placeholder={t`All item types`}
                />
                <Tags
                  name="tags"
                  label={t`Tags`}
                  availableTags={availableTags}
                />
                <Substance
                  name="materialSubstanceId"
                  label={t`Substance`}
                  onChange={(substance) =>
                    setSubstanceId(substance?.value ?? "")
                  }
                />
                <Shape
                  name="materialFormId"
                  label={t`Shape`}
                  onChange={(shape) => setFormId(shape?.value ?? "")}
                />
                <MaterialFinish
                  name="finishId"
                  label={t`Finish`}
                  substanceId={substanceId}
                />
                <MaterialGrade
                  name="gradeId"
                  label={t`Grade`}
                  substanceId={substanceId}
                />
                <MaterialDimension
                  name="dimensionId"
                  label={t`Dimension`}
                  formId={formId}
                />
                <MaterialType
                  name="materialTypeId"
                  label={t`Material Type`}
                  substanceId={substanceId}
                  formId={formId}
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
