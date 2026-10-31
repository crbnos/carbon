// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { Hidden, Input, Item, Number, Submit } from "~/components/Form";
import { inventoryCountUnitValidator } from "~/modules/inventory/inventory.models";
import type { InventoryCountUnitOutcome } from "~/modules/inventory/inventory.service";
import type { action as unitAction } from "~/routes/x+/inventory-count+/$id.units.new";
import { path } from "~/utils/path";

// What the count still needs to record a unit: the item (a new number, or a
// code that matches 2 or more items) or the quantity (a batch).
export type InventoryCountUnitPrompt = {
  code?: string;
  storageUnitId: string | null;
  itemId?: string;
  itemIds?: string[];
  askQuantity?: boolean;
};

type InventoryCountUnitFormProps = {
  inventoryCountId: string;
  prompt: InventoryCountUnitPrompt;
  onClose: () => void;
  onRecorded: (groupId: string) => void;
};

// Add a unit by hand, or finish a scan the count could not place alone.
const InventoryCountUnitForm = ({
  inventoryCountId,
  prompt,
  onClose,
  onRecorded
}: InventoryCountUnitFormProps) => {
  const { t } = useLingui();
  const fetcher = useAction<typeof unitAction>({
    onSuccess: (result) => {
      if (!("data" in result) || !result.data) return;
      const outcome = result.data as InventoryCountUnitOutcome;
      switch (outcome.outcome) {
        case "counted":
        case "added":
          onRecorded(outcome.groupId);
          break;
        case "alreadyCounted":
          toast.info(t`Already counted`);
          onRecorded(outcome.groupId);
          break;
        case "needsQuantity":
          toast.error(t`Enter the quantity counted`);
          break;
        case "needsUnitNumber":
          toast.error(t`Enter the serial or batch number, not the item`);
          break;
        case "notInventory":
          toast.error(t`A Non-Inventory item has no stock to count`);
          break;
        case "wrongStorageUnit":
          toast.error(t`That storage unit is not at this count's location`);
          break;
        default:
          toast.error(t`The item has no serial or batch tracking`);
      }
    }
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ValidatedForm
          validator={inventoryCountUnitValidator}
          method="post"
          action={path.to.inventoryCountUnitNew(inventoryCountId)}
          fetcher={fetcher}
          defaultValues={{
            code: prompt.code ?? "",
            itemId: prompt.itemId ?? "",
            storageUnitId: prompt.storageUnitId ?? undefined
          }}
        >
          <ModalHeader>
            <ModalTitle>{t`Add Unit`}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <Hidden name="storageUnitId" />
              <Input
                name="code"
                label={t`Serial / Batch`}
                autoFocus={!prompt.code}
              />
              <Item
                name="itemId"
                label={t`Item`}
                type="Item"
                whitelist={prompt.itemIds}
                autoFocus={Boolean(prompt.code) && !prompt.itemId}
              />
              <Number
                name="quantity"
                label={t`Quantity`}
                helperText={t`For a batch. A serial counts as 1.`}
                minValue={0}
                autoFocus={prompt.askQuantity}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="secondary" onClick={onClose}>
                {t`Cancel`}
              </Button>
              <Submit>{t`Add`}</Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default InventoryCountUnitForm;
