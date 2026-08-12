import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  toast,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useFetcher, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  CustomFormFields,
  Hidden,
  Item,
  Number,
  StorageUnit,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { MethodItemType } from "~/modules/shared/types";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import { isWarehouseTransferLocked } from "../../inventory.models";
import type { WarehouseTransfer } from "../../types";

const warehouseTransferLineFormValidator = z.discriminatedUnion("type", [
  z.object({
    id: zfd.text(z.string().optional()),
    type: z.literal("create"),
    transferId: z.string().min(1),
    fromLocationId: z.string().min(1),
    toLocationId: z.string().min(1),
    itemId: z.string().min(1),
    quantity: zfd.numeric(z.number().min(0.0001)),
    fromStorageUnitId: zfd.text(z.string().optional()),
    toStorageUnitId: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  }),
  z.object({
    type: z.literal("update"),
    id: z.string().min(1),
    transferId: z.string().min(1),
    itemId: z.string().min(1),
    fromLocationId: z.string().min(1),
    toLocationId: z.string().min(1),
    quantity: zfd.numeric(z.number().min(0.0001)),
    fromStorageUnitId: zfd.text(z.string().optional()),
    toStorageUnitId: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  })
]);

type WarehouseTransferLineFormProps = {
  initialValues: z.infer<typeof warehouseTransferLineFormValidator>;
  warehouseTransfer: WarehouseTransfer;
  onClose: () => void;
};

const WarehouseTransferLineForm = ({
  initialValues,
  warehouseTransfer,
  onClose
}: WarehouseTransferLineFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const { transferId } = useParams();

  if (!transferId) {
    throw new Error("transferId is required");
  }

  const [itemId, setItemId] = useState<string>(
    initialValues.type === "update" ? initialValues.itemId : ""
  );

  const [items] = useItems();
  const [itemType, setItemType] = useState<MethodItemType>(
    // @ts-expect-error - Service
    items.find((item) => item.id === initialValues.itemId)?.type ?? "Item"
  );

  const isEditing = initialValues.id !== undefined;
  const isLocked = isWarehouseTransferLocked(warehouseTransfer.status);
  const isDisabled =
    isLocked ||
    (isEditing
      ? !permissions.can("update", "inventory")
      : !permissions.can("create", "inventory"));

  const action = initialValues.id
    ? path.to.warehouseTransferLine(transferId, initialValues.id)
    : path.to.newWarehouseTransferLine(transferId);

  const fetcher = useFetcher<{ success: boolean; message: string }>();

  useEffect(() => {
    if (fetcher.data?.success === false) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.success, fetcher.data?.message]);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          defaultValues={initialValues}
          validator={warehouseTransferLineFormValidator}
          method="post"
          action={action}
          className="flex flex-col h-full"
          fetcher={fetcher}
          isDisabled={isDisabled}
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? t`Edit Transfer Line` : t`New Transfer Line`}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="transferId" />
            <Hidden name="fromLocationId" />
            <Hidden name="toLocationId" />
            <Hidden name="type" value={isEditing ? "update" : "create"} />

            <VStack spacing={4}>
              <Item
                name="itemId"
                label={t`Item`}
                type={itemType}
                locationId={warehouseTransfer.fromLocationId}
                onTypeChange={(t) => setItemType(t as MethodItemType)}
                value={itemId}
                onChange={(value) => {
                  setItemId(value?.value as string);
                }}
              />
              <Number
                name="quantity"
                label={t`Quantity`}
                minValue={0.0001}
                formatOptions={INPUT_FORMAT.quantity}
                step={INPUT_STEP.quantity}
              />
              <StorageUnit
                name="fromStorageUnitId"
                label={t`From Storage Unit`}
                itemId={itemId ?? undefined}
                locationId={warehouseTransfer.fromLocationId}
              />
              <StorageUnit
                name="toStorageUnitId"
                label={t`To Storage Unit`}
                itemId={itemId ?? undefined}
                locationId={warehouseTransfer.toLocationId}
              />
              <TextArea name="notes" label={t`Notes`} rows={3} />
              <CustomFormFields table="warehouseTransferLine" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit
                isDisabled={isDisabled || fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
                withBlocker={false}
              >
                Save
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default WarehouseTransferLineForm;
