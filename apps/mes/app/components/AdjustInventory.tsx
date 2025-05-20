"use client";

import { LuGitBranchPlus, LuGitPullRequestCreateArrow } from "react-icons/lu";

import { useCarbon } from "@carbon/auth";
import { Combobox, Hidden, Number, Submit, ValidatedForm } from "@carbon/form";
import {
  Button,
  Loading,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  SidebarMenuButton,
  toast,
  useDisclosure,
  useMount,
  VStack,
} from "@carbon/react";
import { useRouteData } from "@carbon/remix";
import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import type { action as endShiftAction } from "~/routes/x+/end-shift";
import { inventoryAdjustmentValidator } from "~/services/inventory.service";
import { useItems } from "~/stores";
import { path } from "~/utils/path";

export function AdjustInventory({ add }: { add: boolean }) {
  const modal = useDisclosure();
  const fetcher = useFetcher<typeof endShiftAction>();
  const [items] = useItems();
  const [loading, setLoading] = useState(false);

  const [shelves, setShelves] = useState<{ value: string; label: string }[]>(
    []
  );
  const [selectedShelf, setSelectedShelf] = useState<string | null>(null);
  const { carbon } = useCarbon();

  const routeData = useRouteData<{
    location: string;
  }>(path.to.authenticatedRoot);

  const onItemChange = async (
    value: { value: string; label: string | JSX.Element } | null
  ) => {
    if (!value || !carbon) return;
    const pickMethod = await carbon
      .from("pickMethod")
      .select("defaultShelfId")
      .eq("itemId", value.value)
      .eq("locationId", routeData?.location ?? "")
      .maybeSingle();

    setSelectedShelf(pickMethod?.data?.defaultShelfId ?? null);
  };

  async function fetchShelvesByLocationId() {
    if (!carbon) {
      toast.error("Failed to fetch shelves");
      return;
    }
    const shelves = await carbon
      .from("shelf")
      .select("id, name")
      .eq("locationId", routeData?.location ?? "");

    setShelves(
      shelves.data?.map((shelf) => ({
        value: shelf.id,
        label: shelf.name,
      })) ?? []
    );
    setLoading(false);
  }

  useMount(() => {
    setLoading(true);
    fetchShelvesByLocationId();
  });

  useEffect(() => {
    if (fetcher.data?.success === true) {
      modal.onClose();
      toast.success(fetcher.data?.message ?? "Inventory adjustment completed");
    }

    if (fetcher.data?.success === false) {
      toast.error(
        fetcher.data?.message ?? "Failed to complete inventory adjustment"
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data?.success]);

  const itemOptions = useMemo(() => {
    return items
      .filter((i) => !["Batch", "Serial"].includes(i.itemTrackingType))
      .map((item) => ({
        label: item.readableIdWithRevision,
        helper: item.name,
        value: item.id,
      }));
  }, [items]);

  return (
    <>
      <SidebarMenuButton onClick={modal.onOpen}>
        {add ? <LuGitPullRequestCreateArrow /> : <LuGitBranchPlus />}
        <span>{add ? "Add" : "Remove"} Inventory</span>
      </SidebarMenuButton>
      {modal.isOpen && (
        <Modal
          open={modal.isOpen}
          onOpenChange={(open) => !open && modal.onClose()}
        >
          <ModalContent>
            <ValidatedForm
              method="post"
              action={path.to.inventoryAdjustment}
              validator={inventoryAdjustmentValidator}
              defaultValues={{
                itemId: "",
                quantity: 1,
                entryType: add ? "Positive Adjmt." : "Negative Adjmt.",
              }}
              fetcher={fetcher}
            >
              <ModalHeader>
                <ModalTitle>{add ? "Add" : "Remove"} Inventory</ModalTitle>
                <ModalDescription>
                  Manually {add ? "add" : "remove"} items to inventory
                </ModalDescription>
              </ModalHeader>
              <ModalBody>
                <Hidden
                  name="entryType"
                  value={add ? "Positive Adjmt." : "Negative Adjmt."}
                />
                <Hidden name="locationId" value={routeData?.location ?? ""} />
                <VStack spacing={4}>
                  <Loading isLoading={loading}>
                    <Combobox
                      label="Item"
                      name="itemId"
                      onChange={onItemChange}
                      options={itemOptions}
                      itemHeight={44}
                    />
                    <Number label="Quantity" name="quantity" />
                    <Combobox
                      label="Shelf"
                      name="shelfId"
                      options={shelves}
                      value={selectedShelf ?? ""}
                      onChange={(value) =>
                        setSelectedShelf(value?.value ?? null)
                      }
                    />
                  </Loading>
                </VStack>
              </ModalBody>

              <ModalFooter>
                <Button
                  type="button"
                  onClick={modal.onClose}
                  variant="secondary"
                >
                  Cancel
                </Button>

                <Submit>{add ? "Add" : "Remove"} Inventory</Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
    </>
  );
}
