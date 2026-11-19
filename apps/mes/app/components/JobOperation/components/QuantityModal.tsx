// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Hidden,
  NumberControlled,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import { type RefObject, useRef, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import {
  finishValidator,
  nonScrapQuantityValidator,
  scrapQuantityValidator
} from "~/services/models";
import type {
  JobMaterial,
  OperationWithDetails,
  ProductionEvent,
  ProductionQuantity
} from "~/services/types";
import { OriginInput } from "~/utils/origin";
import { path } from "~/utils/path";
import { unissuedTrackedMaterials } from "~/utils/trackedMaterials";
import ScrapReason from "./ScrapReason";

// Fractional quantities for weight/length UoMs, capped at the 2 decimals
// jobOperation.quantityComplete/Scrapped/Reworked store.
const QUANTITY_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
};

export function QuantityModal({
  allStepsRecorded = true,
  isFirstOpenOperation = false,
  laborProductionEvent,
  machineProductionEvent,
  materials = [],
  operation,
  parentIsSerial = false,
  parentIsBatch = false,
  requireTrackedMaterialsIssued = false,
  setupProductionEvent,
  trackedEntityId,
  trackedEntityReadableId,
  type,
  returnFocusRef,
  open = true,
  onClose
}: {
  allStepsRecorded?: boolean;
  // The operation is the last of its make method, so it also consumes the
  // tracked materials that have no operation.
  isFirstOpenOperation?: boolean;
  laborProductionEvent: ProductionEvent | undefined;
  machineProductionEvent: ProductionEvent | undefined;
  materials?: JobMaterial[];
  operation: OperationWithDetails;
  parentIsSerial?: boolean;
  parentIsBatch?: boolean;
  // The company refuses completion until the serial and batch materials are
  // scanned in, so the warning becomes a block.
  requireTrackedMaterialsIssued?: boolean;
  setupProductionEvent: ProductionEvent | undefined;
  trackedEntityId: string;
  // Serial parents: the selected unit's serial number, shown in the scrap
  // confirmation so the operator knows exactly which unit is being scrapped.
  trackedEntityReadableId?: string;
  type: "scrap" | "rework" | "complete" | "finish";
  // Where focus goes on close when the control that opened the modal is gone
  // (an item in a sheet that closed as the modal opened).
  returnFocusRef?: RefObject<HTMLElement | null>;
  open?: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const numberFormatter = useNumberFormatter(QUANTITY_FORMAT_OPTIONS);
  // The modal opens from state, not a DialogTrigger, so Radix has no trigger
  // to return focus to and it falls to <body>. Remember the opener instead.
  const [opener] = useState(() =>
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement | null)
  );
  // The action's redirect keeps the page the operation was opened from.
  const fetcher = useAction<ProductionQuantity>({
    onSettled: () => {
      if (submitted.current) {
        onClose();
      }
    }
  });
  const [quantity, setQuantity] = useState(parentIsSerial ? 1 : 0);
  const [confirmedUnissued, setConfirmedUnissued] = useState(false);
  const submitted = useRef(false);
  const isSubmitting = fetcher.state !== "idle";
  // `operation` is live-patched via realtime; after submit it already includes what we
  // just logged, so snapshot at submit time — not mount — to avoid double-counting.
  const [submittedBaseline, setSubmittedBaseline] = useState<{
    complete: number;
    reworked: number;
  } | null>(null);

  const baseline = submittedBaseline ?? {
    complete: operation.quantityComplete,
    reworked: operation.quantityReworked ?? 0
  };

  const titleMap = {
    scrap: t`Log scrap for ${operation.itemReadableId}`,
    rework: t`Log rework for ${operation.itemReadableId}`,
    complete: t`Log completed for ${operation.itemReadableId}`,
    finish: t`Mark ${operation.itemReadableId} as Done`
  };

  // operationQuantity is Math.ceil'd upstream (recalculate/get-method), so a 1.5-unit
  // job reports 2. Matches how x+/complete.tsx decides willBeFinished.
  const targetQuantity =
    operation.targetQuantity ?? operation.operationQuantity ?? 0;

  const isOperationComplete = baseline.complete >= targetQuantity;

  const descriptionMap = {
    scrap: t`Select a scrap quantity and reason`,
    rework: t`Select a rework quantity`,
    complete: t`Select a completion quantity`,
    finish: t`Are you sure you want to mark this operation as done? This will end all active production events for this operation.`
  };

  const actionMap = {
    scrap: path.to.scrap,
    rework: path.to.rework,
    complete: path.to.complete,
    finish: path.to.finish
  };

  const actionButtonMap = {
    scrap: t`Log Scrap`,
    rework: t`Log Rework`,
    complete: t`Log Completed`,
    finish: isOperationComplete ? t`Mark as Done` : t`Mark as Done Anyways`
  };

  const validatorMap = {
    scrap: scrapQuantityValidator,
    rework: nonScrapQuantityValidator,
    complete: nonScrapQuantityValidator,
    finish: finishValidator
  };

  const totalPartsAfterCompletion = parentIsSerial
    ? 1
    : baseline.complete + quantity;

  const missing = unissuedTrackedMaterials({
    materials,
    operationId: operation.id,
    jobMakeMethodId: operation.jobMakeMethodId,
    isFirstOpenOperation: requireTrackedMaterialsIssued && isFirstOpenOperation,
    unitsAfterCompletion: totalPartsAfterCompletion
  });
  const hasUnissuedTrackedMaterials = missing.length > 0;
  const blockedByUnissued =
    requireTrackedMaterialsIssued && type === "complete";

  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target =
            opener?.isConnected && opener !== document.body
              ? opener
              : returnFocusRef?.current;
          target?.focus();
        }}
      >
        <ValidatedForm
          action={actionMap[type]}
          method="post"
          validator={validatorMap[type]}
          defaultValues={{
            // @ts-expect-error
            trackedEntityId:
              parentIsSerial || parentIsBatch ? trackedEntityId : undefined,
            jobOperationId: operation.id,
            quantity: type === "finish" ? undefined : 0,
            setupProductionEventId: setupProductionEvent?.id,
            laborProductionEventId: laborProductionEvent?.id,
            machineProductionEventId: machineProductionEvent?.id
          }}
          fetcher={fetcher}
          onSubmit={() => {
            submitted.current = true;
            setSubmittedBaseline({
              complete: operation.quantityComplete,
              reworked: operation.quantityReworked ?? 0
            });
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
            <OriginInput />
            <VStack spacing={2}>
              {hasUnissuedTrackedMaterials && blockedByUnissued && (
                <Alert variant="destructive">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertTitle>
                    <Trans>Scan in these parts first</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <ul className="flex flex-col gap-1">
                      {missing.map((material) => {
                        const issued = numberFormatter.format(
                          material.quantityIssued ?? 0
                        );
                        const required = numberFormatter.format(
                          (material.quantity ?? 0) * totalPartsAfterCompletion
                        );
                        return (
                          <li
                            key={material.id}
                            className="flex items-center justify-between gap-4"
                          >
                            <span className="font-medium">
                              {material.itemReadableId}
                            </span>
                            <span className="tabular-nums">
                              <Trans>
                                {issued} of {required}
                              </Trans>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {hasUnissuedTrackedMaterials &&
                !blockedByUnissued &&
                type === "complete" && (
                  <Alert variant="destructive">
                    <LuTriangleAlert className="h-4 w-4" />
                    <AlertTitle>
                      <Trans>Unissued serial/batch materials</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        There are serial or batch tracked materials on the bill
                        of material that have not been fully issued. Completing
                        without issuing may result in incorrect traceability
                        records.
                      </Trans>
                    </AlertDescription>
                    <label className="col-start-2 flex items-center gap-2 mt-2 cursor-pointer">
                      <Checkbox
                        isChecked={confirmedUnissued}
                        onCheckedChange={(checked) =>
                          setConfirmedUnissued(checked === true)
                        }
                        className="bg-primary"
                      />
                      <span className="text-sm">
                        <Trans>
                          I understand and want to complete without issuing
                        </Trans>
                      </span>
                    </label>
                  </Alert>
                )}

              {type === "finish" && !isOperationComplete && (
                <Alert variant="destructive">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertTitle>
                    <Trans>Insufficient quantity</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>
                      The completed quantity for this operation is less than the
                      required quantity of {targetQuantity}.
                    </Trans>
                  </AlertDescription>
                </Alert>
              )}
              {type === "finish" && !allStepsRecorded && (
                <Alert variant="destructive">
                  <LuTriangleAlert className="h-4 w-4" />
                  <AlertTitle>
                    <Trans>Steps are missing</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <Trans>
                      Please record all steps for this operation before closing.
                    </Trans>
                  </AlertDescription>
                </Alert>
              )}
              {type !== "finish" && (
                <div className="flex items-end gap-2 w-full">
                  <div className="flex-grow">
                    <NumberControlled
                      name="quantity"
                      label={t`Quantity`}
                      value={quantity}
                      onChange={setQuantity}
                      isReadOnly={parentIsSerial}
                      minValue={0}
                      formatOptions={QUANTITY_FORMAT_OPTIONS}
                      size="lg"
                    />
                  </div>
                  {type === "complete" && !parentIsSerial && (
                    <Button
                      variant="secondary"
                      size="lg"
                      className="h-12"
                      onClick={() =>
                        setQuantity(
                          targetQuantity - baseline.complete - baseline.reworked
                        )
                      }
                    >
                      <Trans>Complete All</Trans>
                    </Button>
                  )}
                </div>
              )}
              {type === "scrap" ? (
                <>
                  {parentIsSerial && (
                    <Alert>
                      <LuTriangleAlert className="h-4 w-4" />
                      <AlertTitle>
                        {trackedEntityReadableId ? (
                          <Trans>
                            Scrapping serial {trackedEntityReadableId}
                          </Trans>
                        ) : (
                          <Trans>Scrapping the selected serial</Trans>
                        )}
                      </AlertTitle>
                      <AlertDescription>
                        <Trans>
                          This unit will be permanently scrapped and a
                          replacement unit will be created.
                        </Trans>
                      </AlertDescription>
                    </Alert>
                  )}
                  <ScrapReason
                    name="scrapReasonId"
                    label={t`Scrap Reason`}
                    size="lg"
                  />
                  <TextArea label={t`Notes`} name="notes" size="lg" />
                </>
              ) : (
                <>
                  <NumberControlled
                    name="totalQuantity"
                    label={t`Total Quantity`}
                    formatOptions={QUANTITY_FORMAT_OPTIONS}
                    size="lg"
                    value={
                      quantity +
                      (type === "rework"
                        ? baseline.reworked
                        : baseline.complete)
                    }
                    isReadOnly
                  />
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="lg" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>

            <Button
              size="lg"
              variant={
                type === "scrap" || (!isOperationComplete && type === "finish")
                  ? "destructive"
                  : "primary"
              }
              type="submit"
              isLoading={isSubmitting}
              disabled={
                isSubmitting ||
                (type === "complete" &&
                  hasUnissuedTrackedMaterials &&
                  (blockedByUnissued || !confirmedUnissued))
              }
            >
              {actionButtonMap[type]}
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
