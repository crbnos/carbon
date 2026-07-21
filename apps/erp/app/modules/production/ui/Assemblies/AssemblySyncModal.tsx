import {
  Badge,
  Button,
  cn,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
  VStack
} from "@carbon/react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

type TargetOperation = {
  id: string;
  description: string | null;
  operationType: string | null;
};

type SyncTargets = {
  methodOperations: TargetOperation[];
  jobs: {
    id: string;
    jobId: string | null;
    operations: (TargetOperation & { jobId: string | null })[];
  }[];
};

/**
 * Pick where a Published instruction's steps land: an operation on the item's
 * active (Draft) make method — future jobs inherit via get-method — or an
 * operation on a live job. Re-running the sync updates previously synced steps
 * in place and never touches hand-authored ones.
 */
export default function AssemblySyncModal({
  instructionId,
  onClose
}: {
  instructionId: string;
  onClose: () => void;
}) {
  const targetsFetcher = useFetcher<SyncTargets>();
  const syncFetcher = useFetcher<{ success: boolean }>();

  const [targetKind, setTargetKind] = useState<"method" | "job">("method");
  const [operationId, setOperationId] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load targets once per open
  useEffect(() => {
    targetsFetcher.load(path.to.assemblySyncBop(instructionId));
  }, [instructionId]);

  useEffect(() => {
    if (syncFetcher.state === "idle" && syncFetcher.data?.success) {
      onClose();
    }
  }, [syncFetcher.state, syncFetcher.data, onClose]);

  const targets = targetsFetcher.data;
  const loading = targetsFetcher.state !== "idle" || !targets;

  const onSync = () => {
    if (!operationId) return;
    const formData = new FormData();
    formData.append("targetKind", targetKind);
    formData.append("operationId", operationId);
    syncFetcher.submit(formData, {
      method: "post",
      action: path.to.assemblySyncBop(instructionId)
    });
  };

  const operationRow = (operation: TargetOperation, prefix?: string | null) => (
    <button
      key={operation.id}
      type="button"
      onClick={() => setOperationId(operation.id)}
      className={cn(
        "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors",
        operationId === operation.id
          ? "border-foreground bg-muted/60"
          : "border-border hover:bg-muted/40"
      )}
    >
      <span className="truncate">
        {prefix ? `${prefix} · ` : ""}
        {operation.description || "Operation"}
      </span>
      {operation.operationType && operation.operationType !== "Process" && (
        <Badge variant="secondary">{operation.operationType}</Badge>
      )}
    </button>
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Sync steps to BOP</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <ToggleGroup
              type="single"
              value={targetKind}
              onValueChange={(value) => {
                if (value === "method" || value === "job") {
                  setTargetKind(value);
                  setOperationId(null);
                }
              }}
            >
              <ToggleGroupItem value="method">Part method</ToggleGroupItem>
              <ToggleGroupItem value="job">Job</ToggleGroupItem>
            </ToggleGroup>

            {loading ? (
              <div className="flex w-full items-center justify-center py-8">
                <Spinner />
              </div>
            ) : targetKind === "method" ? (
              targets.methodOperations.length > 0 ? (
                <VStack spacing={2}>
                  <p className="text-xs text-muted-foreground">
                    Steps are written to the selected operation of the item's
                    active method. Jobs created afterwards inherit them.
                  </p>
                  {targets.methodOperations.map((operation) =>
                    operationRow(operation)
                  )}
                </VStack>
              ) : (
                <p className="w-full py-4 text-sm text-muted-foreground">
                  The item's active method has no operations (or the method
                  isn't Draft). Add an Assembly operation in the part's Bill of
                  Process first, then sync.
                </p>
              )
            ) : targets.jobs.some((job) => job.operations.length > 0) ? (
              <VStack spacing={2}>
                <p className="text-xs text-muted-foreground">
                  Steps are written directly to the selected job operation.
                </p>
                {targets.jobs.flatMap((job) =>
                  job.operations.map((operation) =>
                    operationRow(operation, job.jobId)
                  )
                )}
              </VStack>
            ) : (
              <p className="w-full py-4 text-sm text-muted-foreground">
                No open jobs with operations exist for this item.
              </p>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="solid" onClick={onClose}>
              Cancel
            </Button>
            <Button
              isDisabled={!operationId || syncFetcher.state !== "idle"}
              isLoading={syncFetcher.state !== "idle"}
              onClick={onSync}
            >
              Sync steps
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
