import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useState } from "react";
import {
  finishValidator,
  nonScrapQuantityValidator,
  scrapQuantityValidator,
} from "~/services/models";
import type {
  JobMaterial,
  OperationWithDetails,
  ProductionEvent,
  ProductionQuantity,
} from "~/services/types";
import { path } from "~/utils/path";

import {
  Hidden,
  NumberControlled,
  TextArea,
  ValidatedForm,
} from "@carbon/form";
import { LuTriangleAlert } from "react-icons/lu";
import ScrapReason from "./ScrapReason";

export function QuantityModal({
  allStepsRecorded = true,
  laborProductionEvent,
  machineProductionEvent,
  materials = [],
  operation,
  parentIsSerial = false,
  parentIsBatch = false,
  setupProductionEvent,
  trackedEntityId,
  type,
  onClose,
}: {
  allStepsRecorded?: boolean;
  laborProductionEvent: ProductionEvent | undefined;
  machineProductionEvent: ProductionEvent | undefined;
  materials?: JobMaterial[];
  operation: OperationWithDetails;
  parentIsSerial?: boolean;
  parentIsBatch?: boolean;
  setupProductionEvent: ProductionEvent | undefined;
  trackedEntityId: string;
  type: "scrap" | "rework" | "complete" | "finish";
  onClose: () => void;
}) {
  const fetcher = useFetcher<ProductionQuantity>();
  const [quantity, setQuantity] = useState(type === "finish" ? 0 : 1);

  const titleMap = {
    scrap: `Log scrap for ${operation.itemReadableId}`,
    rework: `Log rework for ${operation.itemReadableId}`,
    complete: `Log completed for ${operation.itemReadableId}`,
    finish: `Close out ${operation.itemReadableId}`,
  };

  const isOperationComplete =
    operation.quantityComplete >= operation.operationQuantity;

  const descriptionMap = {
    scrap: "Select a scrap quantity and reason",
    rework: "Select a rework quantity",
    complete: "Select a completion quantity",
    finish:
      "Are you sure you want to close out this operation? This will end all active production events for this operation.",
  };

  const actionMap = {
    scrap: path.to.scrap,
    rework: path.to.rework,
    complete: path.to.complete,
    finish: path.to.finish,
  };

  const actionButtonMap = {
    scrap: "Log Scrap",
    rework: "Log Rework",
    complete: "Log Completed",
    finish: isOperationComplete ? "Close" : "Close Anyways",
  };

  const validatorMap = {
    scrap: scrapQuantityValidator,
    rework: nonScrapQuantityValidator,
    complete: nonScrapQuantityValidator,
    finish: finishValidator,
  };

  const hasUnissuedMaterials = useMemo(() => {
    return (
      parentIsSerial &&
      materials.some(
        (material) =>
          material.jobOperationId === operation.id &&
          (material?.quantityIssued ?? 0) < (material?.quantity ?? 0)
      )
    );
  }, [materials, parentIsSerial, operation.id]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ValidatedForm
          action={actionMap[type]}
          method="post"
          validator={validatorMap[type]}
          defaultValues={{
            // @ts-ignore
            trackedEntityId:
              parentIsSerial || parentIsBatch ? trackedEntityId : undefined,
            jobOperationId: operation.id,
            // @ts-ignore
            quantity: type === "finish" ? undefined : 1,
            setupProductionEventId: setupProductionEvent?.id,
            laborProductionEventId: laborProductionEvent?.id,
            machineProductionEventId: machineProductionEvent?.id,
          }}
          fetcher={fetcher}
          onSubmit={() => {
            onClose();
          }}
        >
          <ModalHeader>
            <ModalTitle>{titleMap[type]}</ModalTitle>
            <ModalDescription>{descriptionMap[type]}</ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="trackedEntityId" />
            <Hidden
              name="trackingType"
              value={
                parentIsSerial ? "Serial" : parentIsBatch ? "Batch" : undefined
              }
            />
            <Hidden name="jobOperationId" />
            <Hidden name="setupProductionEventId" />
            <Hidden name="laborProductionEventId" />
            <Hidden name="machineProductionEventId" />
            <VStack spacing={2}>
              {hasUnissuedMaterials && (
                <Alert variant="destructive">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertTitle>Unissued materials</AlertTitle>
                  <AlertDescription>
                    Please issue all materials for this operation before
                    closing.
                  </AlertDescription>
                </Alert>
              )}

              {type === "finish" && !isOperationComplete && (
                <Alert variant="destructive">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertTitle>Insufficient quantity</AlertTitle>
                  <AlertDescription>
                    The completed quantity for this operation is less than the
                    required quantity of {operation.operationQuantity}.
                  </AlertDescription>
                </Alert>
              )}
              {type === "finish" && !allStepsRecorded && (
                <Alert variant="destructive">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertTitle>Steps are missing</AlertTitle>
                  <AlertDescription>
                    Please record all steps for this operation before closing.
                  </AlertDescription>
                </Alert>
              )}
              {type !== "finish" && (
                <>
                  <NumberControlled
                    name="quantity"
                    label="Quantity"
                    value={quantity}
                    onChange={setQuantity}
                    isReadOnly={parentIsSerial}
                    minValue={1}
                  />
                </>
              )}
              {type === "scrap" ? (
                <>
                  <ScrapReason name="scrapReasonId" label="Scrap Reason" />
                  <TextArea label="Notes" name="notes" />
                </>
              ) : (
                <>
                  <NumberControlled
                    name="totalQuantity"
                    label="Total Quantity"
                    value={
                      quantity +
                      (type === "rework"
                        ? operation.quantityReworked
                        : operation.quantityComplete)
                    }
                    isReadOnly
                  />
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>

            <Button
              variant={
                type === "scrap" || (!isOperationComplete && type === "finish")
                  ? "destructive"
                  : "primary"
              }
              type="submit"
            >
              {actionButtonMap[type]}
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
