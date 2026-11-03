// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DatePicker, Hidden, Submit, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  cn,
  HStack,
  Input,
  InputGroup,
  InputRightElement,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  VStack
} from "@carbon/react";
import { formatDate, INPUT_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCheck, LuList, LuQrCode } from "react-icons/lu";
import { Number as NumberInput } from "~/components/Form";
import { useQuantityFormatter } from "~/hooks";
import { path } from "~/utils/path";
import { assignBatchValidator } from "../../inventory.models";

/** A batch number the item already has at the location. */
export type ExistingBatch = {
  readableId: string;
  quantity: number;
  expirationDate: string | null;
};

/**
 * Gives a storage unit's unnumbered stock a batch, so a transfer, pick or
 * shipment can take it. The stock stays where it is.
 */
export function AssignBatchModal({
  itemId,
  itemReadableId,
  locationId,
  storageUnitId,
  quantity,
  batches,
  onClose
}: {
  itemId: string;
  itemReadableId: string;
  locationId: string;
  storageUnitId: string | null;
  /** How much in the storage unit has no batch number. */
  quantity: number;
  batches: ExistingBatch[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const formatQuantity = useQuantityFormatter();
  const [tab, setTab] = useState("scan");
  const [batchNumber, setBatchNumber] = useState("");
  const fetcher = useAction({
    onSuccess: () => {
      toast.success(t`Batch assigned`);
      onClose();
    }
  });

  const value = batchNumber.trim();
  // Joining a batch the item already has keeps that batch's expiry.
  const existing = batches.find((batch) => batch.readableId === value);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          validator={assignBatchValidator}
          action={path.to.inventoryItemAssignBatch(itemId)}
          fetcher={fetcher}
          defaultValues={{
            locationId,
            storageUnitId: storageUnitId ?? undefined,
            quantity
          }}
        >
          <ModalHeader>
            <ModalTitle>{itemReadableId}</ModalTitle>
            <ModalDescription>
              <Trans>Scan or choose a batch number</Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="locationId" />
            <Hidden name="storageUnitId" />
            <Hidden name="readableId" value={value} />
            {existing && (
              <Hidden
                name="expirationDate"
                value={existing.expirationDate ?? ""}
              />
            )}
            <VStack spacing={4}>
              <Tabs value={tab} onValueChange={setTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="scan" className="leading-none">
                    <LuQrCode className="mr-2 shrink-0" />
                    <Trans>Scan</Trans>
                  </TabsTrigger>
                  <TabsTrigger value="select" className="leading-none">
                    <LuList className="mr-2 shrink-0" />
                    <Trans>Select</Trans>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="scan" className="mt-2">
                  <VStack spacing={1}>
                    <InputGroup>
                      <Input
                        autoFocus
                        aria-label={t`Batch Number`}
                        placeholder={t`Scan or enter a batch number`}
                        value={batchNumber}
                        onChange={(e) => setBatchNumber(e.target.value)}
                        onKeyDown={(e) => {
                          // A scanner ends with Enter: nothing to send yet.
                          if (e.key === "Enter" && !value) e.preventDefault();
                        }}
                      />
                      <InputRightElement>
                        {existing && <LuCheck className="text-emerald-500" />}
                      </InputRightElement>
                    </InputGroup>
                    {value && (
                      <span className="text-xs text-muted-foreground">
                        {existing ? (
                          <Trans>Adds to an existing batch</Trans>
                        ) : (
                          <Trans>A new batch</Trans>
                        )}
                      </span>
                    )}
                  </VStack>
                </TabsContent>

                <TabsContent value="select" className="mt-2">
                  <ScrollArea className="max-h-[36dvh] w-full">
                    <VStack spacing={2} className="w-full">
                      {batches.length === 0 ? (
                        <p className="w-full py-6 text-center text-xs text-muted-foreground">
                          <Trans>This item has no batches here yet</Trans>
                        </p>
                      ) : (
                        batches.map((batch) => {
                          const selected = batch.readableId === value;
                          return (
                            <HStack
                              key={batch.readableId}
                              className={cn(
                                "w-full justify-between rounded-lg border p-3",
                                selected && "border-primary"
                              )}
                            >
                              <VStack spacing={0} className="min-w-0">
                                <p className="truncate text-base font-medium">
                                  {batch.readableId}
                                </p>
                                <HStack
                                  spacing={2}
                                  className="text-xs text-muted-foreground"
                                >
                                  <span className="tabular-nums">
                                    <Trans>
                                      {formatQuantity(batch.quantity)} available
                                    </Trans>
                                  </span>
                                  {batch.expirationDate && (
                                    <span>
                                      ·{" "}
                                      <Trans>
                                        Expires{" "}
                                        {formatDate(batch.expirationDate)}
                                      </Trans>
                                    </span>
                                  )}
                                </HStack>
                              </VStack>
                              <Button
                                size="sm"
                                variant={selected ? "primary" : "secondary"}
                                onClick={() => {
                                  setBatchNumber(batch.readableId);
                                  setTab("scan");
                                }}
                              >
                                {selected ? (
                                  <Trans>Chosen</Trans>
                                ) : (
                                  <Trans>Choose</Trans>
                                )}
                              </Button>
                            </HStack>
                          );
                        })
                      )}
                    </VStack>
                  </ScrollArea>
                </TabsContent>
              </Tabs>

              <NumberInput
                name="quantity"
                label={t`Quantity`}
                minValue={0}
                maxValue={quantity}
                formatOptions={INPUT_FORMAT.quantity}
              />
              {!existing && (
                <DatePicker name="expirationDate" label={t`Expiration Date`} />
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false} isDisabled={!value}>
              <Trans>Assign Batch</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
