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
import { useFetcher, useNavigation, useParams } from "@remix-run/react";
import { useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { path } from "~/utils/path";

const ShipmentPostModal = ({ onClose }: { onClose: () => void }) => {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const navigation = useNavigation();
  const { carbon } = useCarbon();
  const [validated, setValidated] = useState(false);
  const [validationErrors, setValidationErrors] = useState<
    {
      itemReadableId: string | null;
      shippedQuantity: number;
      shippedQuantityError: string;
    }[]
  >([]);

  const getShipmentLines = async () => {
    if (!carbon) {
      toast.error("Carbon client not found");
      return;
    }
    const [shipmentLines, shipmentLineTracking] = await Promise.all([
      carbon
        .from("shipmentLine")
        .select(
          "id, itemReadableId, shippedQuantity, requiresBatchTracking, requiresSerialTracking"
        )
        .eq("shipmentId", shipmentId),
      carbon
        .from("itemTracking")
        .select("*, serialNumber(number), batchNumber(number)")
        .eq("sourceDocument", "Shipment")
        .eq("sourceDocumentId", shipmentId),
    ]);

    if (shipmentLines.error || shipmentLineTracking.error) {
      toast.error("Error fetching shipment lines or tracking data");
      return;
    }

    const errors: {
      itemReadableId: string | null;
      shippedQuantity: number;
      shippedQuantityError: string;
    }[] = [];

    const shipmentLinesWithTracking = shipmentLines.data.map((line) => ({
      ...line,
      shipmentLineTracking: shipmentLineTracking.data.filter(
        (tracking) => tracking.sourceDocumentLineId === line.id
      ),
    }));

    shipmentLinesWithTracking.forEach((line) => {
      if (
        line.requiresBatchTracking &&
        (line.shipmentLineTracking.length === 0 ||
          !line.shipmentLineTracking[0].batchNumber)
      ) {
        errors.push({
          itemReadableId: line.itemReadableId,
          shippedQuantity: line.shippedQuantity,
          shippedQuantityError: "Batch number is required",
        });
      }

      if (line.requiresSerialTracking) {
        const quantityWithSerial = line.shipmentLineTracking.reduce(
          (acc, tracking) => acc + tracking.quantity,
          0
        );
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
    getShipmentLines();
  });

  const fetcher = useFetcher<{}>();

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
