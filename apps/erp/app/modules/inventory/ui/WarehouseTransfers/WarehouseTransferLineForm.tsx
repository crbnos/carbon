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
  VStack,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  CustomFormFields,
  Hidden,
  Item,
  Number,
  Shelf,
  Submit,
  TextArea,
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { MethodItemType } from "~/modules/shared/types";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
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
    fromShelfId: zfd.text(z.string().optional()),
    toShelfId: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional()),
  }),
  z.object({
    type: z.literal("update"),
    id: z.string().min(1),
    transferId: z.string().min(1),
    itemId: z.string().min(1),
    fromLocationId: z.string().min(1),
    toLocationId: z.string().min(1),
    quantity: zfd.numeric(z.number().min(0.0001)),
    fromShelfId: zfd.text(z.string().optional()),
    toShelfId: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional()),
  }),
]);

type WarehouseTransferLineFormProps = {
  initialValues: z.infer<typeof warehouseTransferLineFormValidator>;
  warehouseTransfer: WarehouseTransfer;
  onClose: () => void;
};

const WarehouseTransferLineForm = ({
  initialValues,
  warehouseTransfer,
  onClose,
}: WarehouseTransferLineFormProps) => {
  const permissions = usePermissions();
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
  const isDisabled = isEditing
    ? !permissions.can("update", "inventory")
    : !permissions.can("create", "inventory");

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
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? "Edit" : "New"} Transfer Line
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
                label="Item"
                type={itemType}
                onTypeChange={(t) => setItemType(t as MethodItemType)}
                value={itemId}
                onChange={(value) => {
                  setItemId(value?.value as string);
                }}
              />
              <Number
                name="quantity"
                label="Quantity"
                minValue={0.0001}
                step={0.0001}
              />
              <Shelf
                name="fromShelfId"
                label="From Shelf"
                locationId={warehouseTransfer.fromLocationId}
              />
              <Shelf
                name="toShelfId"
                label="To Shelf"
                locationId={warehouseTransfer.toLocationId}
              />
              <TextArea name="notes" label="Notes" rows={3} />
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
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default WarehouseTransferLineForm;
