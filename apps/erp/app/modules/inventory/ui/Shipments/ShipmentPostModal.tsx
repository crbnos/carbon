import { useCarbon } from "@carbon/auth";
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
} from "@carbon/react";
import { useRouteData } from "@carbon/remix";
import { useFetcher, useNavigation, useParams } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { getShipmentTracking } from "../..";
import type { ShipmentLine } from "../..";
import { path } from "~/utils/path";
import type { TrackedEntityAttributes } from "~/modules/shared";
import { useUser } from "~/hooks";

const ShipmentPostModal = ({ onClose }: { onClose: () => void }) => {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const routeData = useRouteData<{
    shipmentLines: ShipmentLine[];
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
    company: { id: companyId },
  } = useUser();

  const validateShipmentTracking = async () => {
    const errors: {
      itemReadableId: string | null;
      shippedQuantity: number;
      shippedQuantityError: string;
    }[] = [];

    if (!carbon) {
      toast.error("Carbon client is not available");
      return;
    }

    const shipmentLineTracking = await getShipmentTracking(
      carbon,
      shipmentId,
      companyId
    );

    if (
      routeData?.shipmentLines.length === 0 ||
      routeData?.shipmentLines.every((line) => line.shippedQuantity === 0)
    ) {
      setValidationErrors([
        {
          itemReadableId: null,
          shippedQuantity: 0,
          shippedQuantityError: "Shipment is empty",
        },
      ]);
    }

    routeData?.shipmentLines.forEach((line: ShipmentLine) => {
      if (line.requiresBatchTracking) {
        const trackedEntity = shipmentLineTracking.data?.find((tracking) => {
          const attributes = tracking.attributes as TrackedEntityAttributes;
          return attributes["Shipment Line"] === line.id;
        });

        const attributes = trackedEntity?.attributes as
          | TrackedEntityAttributes
          | undefined;
        if (!attributes?.["Batch Number"]) {
          errors.push({
            itemReadableId: line.itemReadableId,
            shippedQuantity: line.shippedQuantity,
            shippedQuantityError: "Batch number is required",
          });
        }
      }

      if (line.requiresSerialTracking) {
        const trackedEntities = shipmentLineTracking.data?.filter(
          (tracking) => {
            const attributes = tracking.attributes as TrackedEntityAttributes;
            return attributes["Shipment Line"] === line.id;
          }
        );

        const quantityWithSerial = trackedEntities?.reduce((acc, tracking) => {
          const attributes = tracking.attributes as TrackedEntityAttributes;
          const serialNumber = attributes["Serial Number"];

          return acc + (serialNumber ? 1 : 0);
        }, 0);

        if (quantityWithSerial !== line.shippedQuantity) {
          errors.push({
            itemReadableId: line.itemReadableId,
            shippedQuantity: line.shippedQuantity,
            shippedQuantityError: "Serial numbers are missing",
          });
        }
      }
    });

    setValidationErrors(errors);
    setValidated(true);
  };

  useMount(() => {
    validateShipmentTracking();
  });

  const fetcher = useFetcher<{}>();
  const submitted = useRef(false);
  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

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
          <ModalTitle>Post Shipment</ModalTitle>
          <ModalDescription>
            Are you sure you want to post this shipment?
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {validationErrors.length > 0 && (
            <Alert variant="destructive">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>Missing Information</AlertTitle>
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
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="solid" onClick={onClose}>
              Cancel
            </Button>
            <fetcher.Form
              action={path.to.shipmentPost(shipmentId)}
              method="post"
              onSubmit={() => {
                submitted.current = true;
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
                Post Shipment
              </Button>
            </fetcher.Form>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ShipmentPostModal;
