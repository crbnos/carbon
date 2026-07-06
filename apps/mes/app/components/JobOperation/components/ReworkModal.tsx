import type { Result } from "@carbon/auth";
import type { Database } from "@carbon/database";
import {
  Hidden,
  NumberControlled,
  Select,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
  Checkbox,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { triggerReworkValidator } from "~/services/models";
import type { OperationWithDetails } from "~/services/types";
import { path } from "~/utils/path";

type UpstreamOperation = {
  id: string;
  processId: string;
  description: string | null;
  order: number;
  status: string;
  jobMakeMethod: {
    item: { name: string | null } | null;
  } | null;
};

type TrackedEntity = Database["public"]["Tables"]["trackedEntity"]["Row"];

export function ReworkModal({
  operation,
  jobId,
  isOpen,
  onClose,
  trackedEntities = [],
  parentIsSerial,
  parentIsBatch
}: {
  operation: OperationWithDetails;
  jobId: string;
  isOpen: boolean;
  onClose: () => void;
  trackedEntities?: TrackedEntity[];
  parentIsSerial?: boolean;
  parentIsBatch?: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<Result>();
  const targetsFetcher = useFetcher<{
    operations: UpstreamOperation[];
  }>();

  const maxQuantity = operation.operationQuantity ?? 0;
  const defaultQuantity = Math.max(
    maxQuantity -
      (operation.quantityComplete ?? 0) -
      (operation.quantityScrapped ?? 0),
    1
  );
  const [quantity, setQuantity] = useState(defaultQuantity);
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(
    new Set()
  );
  const [scanInput, setScanInput] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");

  const targets = targetsFetcher.data?.operations ?? [];

  useEffect(() => {
    if (isOpen) {
      targetsFetcher.load(path.to.reworkTargets(operation.id));
      setSelectedEntityIds(
        parentIsSerial && trackedEntities.length === 1
          ? new Set([trackedEntities[0].id])
          : new Set()
      );
      setScanInput("");
      setSelectedBatchId(
        parentIsBatch && trackedEntities.length === 1
          ? trackedEntities[0].id
          : ""
      );
    }
  }, [
    isOpen,
    operation.id,
    parentIsSerial,
    parentIsBatch,
    trackedEntities,
    targetsFetcher.load
  ]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success(t`Rework created successfully`);
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose, t]);

  const filteredEntities = useMemo(() => {
    if (!scanInput) return trackedEntities;
    const search = scanInput.toLowerCase();
    return trackedEntities.filter(
      (e) =>
        e.id.toLowerCase().includes(search) ||
        e.readableId?.toLowerCase().includes(search)
    );
  }, [trackedEntities, scanInput]);

  const toggleEntity = (id: string) => {
    setSelectedEntityIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const match = trackedEntities.find(
        (entity) => entity.id === scanInput || entity.readableId === scanInput
      );
      if (match) {
        setSelectedEntityIds((prev) => new Set(prev).add(match.id));
        setScanInput("");
      }
    }
  };

  const serialQuantity = selectedEntityIds.size;
  const selectedBatch = trackedEntities.find((e) => e.id === selectedBatchId);
  const batchMaxQuantity = selectedBatch
    ? Number(selectedBatch.quantity)
    : maxQuantity;

  const trackedEntityIdsValue = parentIsSerial
    ? JSON.stringify(Array.from(selectedEntityIds))
    : parentIsBatch && selectedBatchId
      ? JSON.stringify([selectedBatchId])
      : undefined;

  if (!isOpen) return null;

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.triggerRework}
          validator={triggerReworkValidator}
          defaultValues={{
            jobId,
            triggeredAtJobOperationId: operation.id,
            targetJobOperationId: "",
            reason: "",
            quantity: defaultQuantity
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Create Rework</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Select the operation to go back to. All operations from that
                point to the current operation will be redone.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="jobId" value={jobId} />
            <Hidden name="triggeredAtJobOperationId" value={operation.id} />
            {trackedEntityIdsValue && (
              <Hidden name="trackedEntityIds" value={trackedEntityIdsValue} />
            )}
            <VStack spacing={2}>
              <Select
                name="targetJobOperationId"
                label={t`Go back to operation`}
                size="lg"
                options={targets.map((op) => ({
                  value: op.id,
                  label: op.jobMakeMethod?.item?.name ? (
                    <span>
                      {op.description || op.processId}
                      <span className="text-muted-foreground text-xs ml-2">
                        {op.jobMakeMethod.item.name}
                      </span>
                    </span>
                  ) : (
                    op.description || op.processId
                  )
                }))}
              />

              {parentIsSerial ? (
                <div>
                  <Hidden name="quantity" value={String(serialQuantity || 1)} />
                  <div className="w-full flex flex-col gap-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      <Trans>Serial numbers</Trans>
                      {serialQuantity > 0 && (
                        <span className="ml-1.5">
                          ({serialQuantity} selected)
                        </span>
                      )}
                    </label>
                    <Input
                      value={scanInput}
                      onChange={(e) => setScanInput(e.target.value)}
                      onKeyDown={handleScanKeyDown}
                      placeholder={t`Scan or search serial number...`}
                      size="lg"
                    />
                    <div className="max-h-48 overflow-y-auto rounded-lg border">
                      {filteredEntities.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          <Trans>No serial numbers found</Trans>
                        </div>
                      ) : (
                        filteredEntities.map((entity) => (
                          <label
                            key={entity.id}
                            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors hover:bg-muted/50 border-b last:border-b-0"
                          >
                            <Checkbox
                              isChecked={selectedEntityIds.has(entity.id)}
                              onCheckedChange={() => toggleEntity(entity.id)}
                              aria-label={entity.readableId || entity.id}
                            />
                            <div className="flex flex-col min-w-0">
                              {entity.readableId ? (
                                <>
                                  <span className="text-sm font-medium truncate">
                                    {entity.readableId}
                                  </span>
                                  <span className="text-xs text-muted-foreground font-mono truncate">
                                    {entity.id}
                                  </span>
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground font-mono truncate">
                                  {entity.id}
                                </span>
                              )}
                            </div>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : parentIsBatch ? (
                <>
                  <Select
                    name="_batchSelect"
                    label={t`Batch`}
                    size="lg"
                    options={trackedEntities.map((entity) => ({
                      value: entity.id,
                      label: `${entity.readableId || entity.id} (qty: ${entity.quantity})`
                    }))}
                    onChange={(option) => {
                      setSelectedBatchId(option?.value ?? "");
                      setQuantity(1);
                    }}
                  />
                  <NumberControlled
                    name="quantity"
                    label={t`Quantity`}
                    value={quantity}
                    onChange={setQuantity}
                    minValue={1}
                    maxValue={batchMaxQuantity}
                    size="lg"
                  />
                </>
              ) : (
                <NumberControlled
                  name="quantity"
                  label={t`Quantity`}
                  value={quantity}
                  onChange={setQuantity}
                  minValue={1}
                  maxValue={maxQuantity}
                  size="lg"
                />
              )}

              <TextArea
                name="reason"
                label={t`Reason for rework`}
                placeholder={t`Describe what needs to be reworked...`}
                size="lg"
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="secondary" size="lg" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                type="submit"
                size="lg"
                isDisabled={
                  fetcher.state !== "idle" ||
                  (parentIsSerial && serialQuantity === 0)
                }
                isLoading={fetcher.state !== "idle"}
              >
                <Trans>Create Rework</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
