import { useCarbon } from "@carbon/auth";
import { useStorageRuleViolations } from "@carbon/ee/storage-rules";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  toast,
  useMount,
  useRouteData
} from "@carbon/react";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useNavigation, useParams } from "react-router";
import { useUser } from "~/hooks";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import { reconcileReceiptLineSerials } from "../../inventory.models";
import { getReceiptTracking } from "../../inventory.service";
import type { ReceiptLine } from "../../types";

const ReceiptPostModal = ({ onClose }: { onClose: () => void }) => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const { t } = useLingui();
  const [items] = useItems();
  const routeData = useRouteData<{
    receiptLines: ReceiptLine[];
    fixedAssetLines: {
      id: string;
      received: boolean;
    }[];
  }>(path.to.receipt(receiptId));

  const navigation = useNavigation();

  const [validated, setValidated] = useState(false);
  const [validationErrors, setValidationErrors] = useState<
    {
      itemReadableId: string | null;
      receivedQuantity: number;
      receivedQuantityError: string;
    }[]
  >([]);

  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();

  const validateReceiptTracking = async () => {
    const errors: {
      itemReadableId: string | null;
      receivedQuantity: number;
      receivedQuantityError: string;
    }[] = [];

    if (!carbon) {
      toast.error(t`Carbon client is not available`);
      return;
    }

    const receiptLineTracking = await getReceiptTracking(
      carbon,
      receiptId,
      companyId
    );

    const hasReceiptLines = routeData?.receiptLines.some(
      (line) => (line.receivedQuantity ?? 0) > 0
    );
    const hasFaLines = (routeData?.fixedAssetLines ?? []).some(
      (line) => line.received
    );

    if (!hasReceiptLines && !hasFaLines) {
      setValidationErrors([
        {
          itemReadableId: null,
          receivedQuantity: 0,
          receivedQuantityError: "Receipt is empty"
        }
      ]);
    }

    routeData?.receiptLines.forEach((line: ReceiptLine) => {
      if (line.requiresBatchTracking) {
        if (line.receivedQuantity === 0) return;
        const trackedEntity = receiptLineTracking.data?.find((tracking) => {
          const attributes = tracking.attributes as TrackedEntityAttributes;
          return attributes["Receipt Line"] === line.id;
        });

        if (!trackedEntity?.readableId) {
          errors.push({
            itemReadableId: getItemReadableId(items, line.itemId) ?? null,
            receivedQuantity: line.receivedQuantity ?? 0,
            receivedQuantityError: "Batch number is required"
          });
        }
      }

      if (line.requiresSerialTracking) {
        const receivedQuantity = line.receivedQuantity ?? 0;
        if (receivedQuantity === 0) return;

        // post-receipt consumes one serial per index in [0, receivedQuantity);
        // extra or duplicate entities are ignored at post time. Validate that
        // every required index has a serial via the same reconciliation the
        // post route uses, rather than comparing a raw count.
        const entities = (receiptLineTracking.data ?? [])
          .filter((tracking) => {
            const attributes = tracking.attributes as TrackedEntityAttributes;
            return attributes["Receipt Line"] === line.id;
          })
          .map((tracking) => ({
            id: tracking.id,
            index: (tracking.attributes as TrackedEntityAttributes)[
              "Receipt Line Index"
            ],
            hasSerial: !!tracking.readableId
          }));

        const { missingIndexes } = reconcileReceiptLineSerials(
          entities,
          receivedQuantity
        );

        if (missingIndexes.length > 0) {
          errors.push({
            itemReadableId: getItemReadableId(items, line.itemId) ?? null,
            receivedQuantity,
            receivedQuantityError: "Serial numbers are missing"
          });
        }
      }
    });

    setValidationErrors(errors);
    setValidated(true);
  };

  useMount(() => {
    validateReceiptTracking();
  });

  const ruleViolations = useStorageRuleViolations({
    action: path.to.receiptPost(receiptId),
    onSuccess: onClose
  });
  const { fetcher } = ruleViolations;

  return (
    <Modal
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Post Receipt</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          {validationErrors.length > 0 ? (
            <Alert variant="destructive">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>Missing Information</Trans>
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 mt-2 space-y-1">
                  {validationErrors.map((error, index) => (
                    <li key={index} className="text-sm font-medium">
                      <span className="font-mono">{error.itemReadableId}</span>
                      <span className="text-muted-foreground ml-2">
                        {error.receivedQuantity}
                      </span>
                      <span className="block mt-0.5 text-red-500 font-normal">
                        {error.receivedQuantityError}
                      </span>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">
              <Trans>Are you sure you want to post this receipt?</Trans>
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="solid" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ruleViolations.submit(new FormData());
              }}
            >
              <Button
                isLoading={fetcher.state !== "idle"}
                isDisabled={
                  fetcher.state !== "idle" ||
                  navigation.state !== "idle" ||
                  !validated ||
                  validationErrors.length > 0
                }
                type="submit"
              >
                Post Receipt
              </Button>
            </form>
          </HStack>
        </ModalFooter>
      </ModalContent>
      <ruleViolations.ViolationModal />
    </Modal>
  );
};

export default ReceiptPostModal;
