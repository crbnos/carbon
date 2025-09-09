import { useCarbon } from "@carbon/auth";
import { SelectControlled, ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  toast,
  VStack,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useState } from "react";
import type { z } from "zod";
import { Enumerable } from "~/components/Enumerable";
import { Item, Location, Number, Submit } from "~/components/Form";
import type { MethodItemType } from "~/modules/shared/types";
import { path } from "~/utils/path";
import {
  kanbanValidator,
  replenishmentSystemTypes,
} from "../../inventory.models";

type KanbanFormValues = z.infer<typeof kanbanValidator>;

type KanbanFormProps = {
  initialValues: KanbanFormValues;
  locationId?: string;
  onClose: () => void;
};

const KanbanForm = ({ initialValues, onClose }: KanbanFormProps) => {
  const fetcher = useFetcher<{ success: boolean; message: string }>();

  const [selectedReplenishmentSystem, setSelectedReplenishmentSystem] =
    useState<string>(initialValues.replenishmentSystem || "Buy");

  const isEditing = Boolean(initialValues.id);

  const [itemType, setItemType] = useState<MethodItemType | "Item">("Item");
  const onTypeChange = (type: MethodItemType) => {
    setItemType(type);
  };

  const { carbon } = useCarbon();

  const onItemChange = async (value: { value: string } | null) => {
    if (!carbon || !value) return;
    const item = await carbon
      .from("item")
      .select("replenishmentSystem")
      .eq("id", value.value)
      .single();
    if (item.error) {
      toast.error("Failed to load item details");
      return;
    }
    setSelectedReplenishmentSystem(item.data?.replenishmentSystem || "Buy");
  };

  return (
    <Drawer open onOpenChange={onClose}>
      <DrawerContent>
        <ValidatedForm
          fetcher={fetcher}
          method="post"
          action={
            isEditing ? path.to.kanban(initialValues.id!) : path.to.newKanban
          }
          validator={kanbanValidator}
          defaultValues={initialValues}
          onSubmit={onClose}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? "Edit Kanban" : "New Kanban"}
            </DrawerTitle>
            <DrawerDescription>
              {isEditing
                ? "Update the kanban information for scan-based replenishment."
                : "Create a new kanban card for scan-based replenishment."}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              {isEditing && (
                <input type="hidden" name="id" value={initialValues.id} />
              )}

              <div className="grid grid-cols-1 gap-4 w-full">
                <Item
                  name="itemId"
                  label="Item"
                  type="Item"
                  itemType={itemType}
                  // @ts-ignore
                  onTypeChange={onTypeChange}
                  onChange={onItemChange}
                  isReadOnly={isEditing}
                />

                <Number
                  name="quantity"
                  label="Quantity"
                  minValue={1}
                  helperText="The quantity of the item to be reordered on scan-based replenishment."
                />

                <SelectControlled
                  value={selectedReplenishmentSystem}
                  name="replenishmentSystem"
                  label="Replenishment System"
                  onChange={(value) => {
                    console.log(value);
                  }}
                  options={replenishmentSystemTypes
                    .filter((type) => type !== "Buy and Make")
                    .map((type) => ({
                      value: type,
                      label: <Enumerable value={type} />,
                    }))}
                />

                <Location
                  name="locationId"
                  label="Location"
                  isReadOnly={isEditing}
                />
              </div>
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Submit withBlocker={false}>
                {isEditing ? "Update" : "Create"} Kanban
              </Submit>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default KanbanForm;
