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
  ModalDescription,
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
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useNavigation, useParams } from "react-router";
import { useSettings, useUser } from "~/hooks";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { ShipmentLine } from "../..";
import { getShipmentTracking } from "../..";

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

const ShipmentPostModal = ({ onClose }: { onClose: () => void }) => {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const { t } = useLingui();
  const [items] = useItems();
  const routeData = useRouteData<{
    shipmentLines: ShipmentLine[];
    fixedAssetLines: {
      id: string;
      shipped: boolean;
    }[];
  }>(path.to.shipment(shipmentId));

  const navigation = useNavigation();

  const [validated, setValidated] = useState(false);
  const [validationErrors, setValidationErrors] = useState<
    {
      itemReadableId: string | null;
      shippedQuantity: number;
      shippedQuantityError: string;
    }[]
  >([]);

  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();
  const settings = useSettings();
  const expiredPolicy: ExpiredEntityPolicy =
    (
      (settings.inventoryShelfLife as {
        expiredEntityPolicy?: ExpiredEntityPolicy;
      } | null) ?? null
    )?.expiredEntityPolicy ?? "Block";

  const [expiredWarnings, setExpiredWarnings] = useState<
    {
      itemReadableId: string | null;
      readableId: string;
      expirationDate: string;
    }[]
  >([]);
  const [expiredErrors, setExpiredErrors] = useState<
    {
      itemReadableId: string | null;
      readableId: string;
      expirationDate: string;
    }[]
  >([]);

  const validateShipmentTracking = async () => {
    const errors: {
      itemReadableId: string | null;
      shippedQuantity: number;
      shippedQuantityError: string;
    }[] = [];

    if (!carbon) {
      toast.error(t`Carbon client is not available`);
      return;
    }

    const shipmentLineTracking = await getShipmentTracking(
      carbon,
      shipmentId,
      companyId
    );

    const hasShipmentLines = routeData?.shipmentLines.some(
      (line) => (line.shippedQuantity ?? 0) > 0
    );
    const hasFaLines = (routeData?.fixedAssetLines ?? []).some(
      (line) => line.shipped
    );

    if (!hasShipmentLines && !hasFaLines) {
      setValidationErrors([
        {
          itemReadableId: null,
          shippedQuantity: 0,
          shippedQuantityError: "Shipment is empty"
        }
      ]);
    }

    const todayLocal = today(getLocalTimeZone());
    const isExpired = (expirationDate: string | null | undefined) => {
      if (!expirationDate) return false;
      try {
        return parseDate(expirationDate).compare(todayLocal) < 0;
      } catch {
        return false;
      }
    };
    const expiredCollected: {
      itemReadableId: string | null;
      readableId: string;
      expirationDate: string;
    }[] = [];
    const expiredBlocked: {
      itemReadableId: string | null;
      readableId: string;
      expirationDate: string;
    }[] = [];

    routeData?.shipmentLines.forEach((line: ShipmentLine) => {
      if (line.requiresBatchTracking) {
        const trackedEntity = shipmentLineTracking.data?.find((tracking) => {
          const attributes = tracking.attributes as TrackedEntityAttributes;
          return attributes["Shipment Line"] === line.id;
        });

        if (trackedEntity?.status !== "Available") {
          errors.push({
            itemReadableId: getItemReadableId(items, line.itemId) ?? null,
            shippedQuantity: line.shippedQuantity ?? 0,
            shippedQuantityError: "Tracked entity is not available"
          });
        }

        if (trackedEntity && isExpired(trackedEntity.expirationDate)) {
          const itemReadableId = getItemReadableId(items, line.itemId) ?? null;
          const readableId = trackedEntity.readableId ?? trackedEntity.id;
          const entry = {
            itemReadableId,
            readableId,
            expirationDate: trackedEntity.expirationDate as string
          };
          if (
            expiredPolicy === "Block" ||
            expiredPolicy === "BlockWithOverride"
          ) {
            expiredBlocked.push(entry);
          } else {
            expiredCollected.push(entry);
          }
        }
      }

      if (line.requiresSerialTracking) {
        const trackedEntities = shipmentLineTracking.data?.filter(
          (tracking) => {
            const attributes = tracking.attributes as TrackedEntityAttributes;
            return attributes["Shipment Line"] === line.id;
          }
        );

        const quantityAvailable = trackedEntities?.reduce((acc, tracking) => {
          const trackingQuantity = Number(tracking.quantity);

          return acc + (tracking.status === "Available" ? trackingQuantity : 0);
        }, 0);

        if (quantityAvailable !== line.shippedQuantity) {
          errors.push({
            itemReadableId: getItemReadableId(items, line.itemId) ?? null,
            shippedQuantity: line.shippedQuantity ?? 0,
            shippedQuantityError: "Serial numbers are missing or unavailable"
          });
        }

        trackedEntities?.forEach((trackedEntity) => {
          if (!isExpired(trackedEntity.expirationDate)) return;
          const itemReadableId = getItemReadableId(items, line.itemId) ?? null;
          const readableId = trackedEntity.readableId ?? trackedEntity.id;
          const entry = {
            itemReadableId,
            readableId,
            expirationDate: trackedEntity.expirationDate as string
          };
          if (
            expiredPolicy === "Block" ||
            expiredPolicy === "BlockWithOverride"
          ) {
            expiredBlocked.push(entry);
          } else {
            expiredCollected.push(entry);
          }
        });
      }
    });

    setValidationErrors(errors);
    setExpiredWarnings(expiredCollected);
    setExpiredErrors(expiredBlocked);
    setValidated(true);
  };

  useMount(() => {
    validateShipmentTracking();
  });

  const ruleViolations = useStorageRuleViolations({
    action: path.to.shipmentPost(shipmentId),
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
            <Trans>Post Shipment</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>Are you sure you want to post this shipment?</Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {validationErrors.length > 0 && (
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
                        {error.shippedQuantity}
                      </span>
                      <span className="block mt-0.5 text-red-500 font-normal">
                        {error.shippedQuantityError}
                      </span>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {expiredErrors.length > 0 && (
            <Alert variant="destructive" className="mt-4">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>Expired Batches</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>
                  Cannot post — shipment contains expired tracked entities.
                </Trans>
                <ul className="list-disc pl-4 mt-2 space-y-1">
                  {expiredErrors.map((w, index) => (
                    <li key={index} className="text-sm font-medium">
                      <span className="font-mono">{w.itemReadableId}</span>
                      <span className="text-muted-foreground ml-2">
                        {w.readableId}
                      </span>
                      <span className="block mt-0.5 text-red-500 font-normal">
                        Expired on {w.expirationDate}
                      </span>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {expiredWarnings.length > 0 && (
            <Alert variant="warning" className="mt-4">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>Expired Batches</Trans>
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 mt-2 space-y-1">
                  {expiredWarnings.map((w, index) => (
                    <li key={index} className="text-sm font-medium">
                      <span className="font-mono">{w.itemReadableId}</span>
                      <span className="text-muted-foreground ml-2">
                        {w.readableId}
                      </span>
                      <span className="block mt-0.5 text-amber-600 font-normal">
                        Expired on {w.expirationDate}
                      </span>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
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
                  validationErrors.length > 0 ||
                  expiredErrors.length > 0
                }
                type="submit"
              >
                Post Shipment
              </Button>
            </form>
          </HStack>
        </ModalFooter>
      </ModalContent>
      <ruleViolations.ViolationModal />
    </Modal>
  );
};

export default ShipmentPostModal;
