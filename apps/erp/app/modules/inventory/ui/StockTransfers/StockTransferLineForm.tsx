import { ValidatedForm } from "@carbon/form";
import {
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  toast,
  VStack
} from "@carbon/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { useFetcher, useParams } from "react-router";
import type { z } from "zod/v3";
// biome-ignore lint/suspicious/noShadowRestrictedNames: suppressed due to migration
import { Hidden, Item, Number, Shelf, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { stockTransferLineValidator } from "~/modules/inventory";
import type { MethodItemType } from "~/modules/shared/types";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";

type StockTransferLineFormProps = {
  initialValues: z.infer<typeof stockTransferLineValidator>;
  locationId: string;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
};

const StockTransferLineForm = ({
  initialValues,
  locationId,
  open = true,
  type = "drawer",
  onClose
}: StockTransferLineFormProps) => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();
  const [items] = useItems();
  const [itemId, setItemId] = useState<string | null>(
    initialValues.itemId ?? null
  );

  const [itemType, setItemType] = useState<MethodItemType | "Item">(() => {
    if (initialValues.itemId) {
      return (
        (items.find((item) => item.id === initialValues.itemId)
          ?.type as MethodItemType) ?? "Item"
      );
    }
    return "Item";
  });

  const [itemTrackingType, setItemTrackingType] = useState<string | null>(
    () => {
      if (initialValues.itemId) {
        return (
          items.find((item) => item.id === initialValues.itemId)
            ?.itemTrackingType ?? null
        );
      }
      return null;
    }
  );

  const onTypeChange = (t: MethodItemType | "Item") => {
    setItemType(t);
    setItemId(null);
  };

  const onItemChange = (itemId: string) => {
    setItemId(itemId);
    const item = items.find((item) => item.id === itemId);
    const itemType = (item?.type as MethodItemType) ?? "Item";
    const trackingType = item?.itemTrackingType ?? null;
    setItemType(itemType);
    setItemTrackingType(trackingType);
  };

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(`Created stock transfer line`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        `Failed to create stock transfer line: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "inventory")
    : !permissions.can("create", "inventory");

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
            validator={stockTransferLineValidator}
            method="post"
            action={
              isEditing
                ? path.to.stockTransferLine(id, initialValues.id!)
                : path.to.newStockTransferLine(id)
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Line
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="stockTransferId" />
              <Hidden
                name="requiresSerialTracking"
                value={itemTrackingType === "Serial" ? "true" : "false"}
              />
              <Hidden
                name="requiresBatchTracking"
                value={itemTrackingType === "Batch" ? "true" : "false"}
              />
              <VStack spacing={4}>
                <Item
                  name="itemId"
                  label={itemType}
                  // @ts-ignore
                  type={itemType}
                  onTypeChange={onTypeChange}
                  onChange={(value) => {
                    onItemChange(value?.value as string);
                  }}
                  value={itemId ?? undefined}
                />
                <Number
                  name="quantity"
                  label="Quantity"
                  minValue={itemTrackingType === "Serial" ? 1 : 0}
                  maxValue={itemTrackingType === "Serial" ? 1 : undefined}
                  defaultValue={itemTrackingType === "Serial" ? 1 : undefined}
                />
                <Shelf
                  name="fromShelfId"
                  label="From Shelf"
                  locationId={locationId}
                  itemId={itemId ?? undefined}
                />
                <Shelf
                  name="toShelfId"
                  label="To Shelf"
                  locationId={locationId}
                  itemId={itemId ?? undefined}
                />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default StockTransferLineForm;
