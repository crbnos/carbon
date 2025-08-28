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
} from "@carbon/react";
import { useFetcher, useNavigation, useParams } from "@remix-run/react";
import { useEffect, useRef } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { path } from "~/utils/path";

const ShipmentVoidModal = ({ onClose }: { onClose: () => void }) => {
  const { shipmentId } = useParams();
  if (!shipmentId) throw new Error("shipmentId not found");

  const navigation = useNavigation();
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
          <ModalTitle>Void Shipment</ModalTitle>
          <ModalDescription>
            Are you sure you want to void this shipment? This action will reverse all inventory transactions and cannot be undone.
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <Alert variant="destructive">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription>
              Voiding this shipment will:
              <ul className="list-disc pl-4 mt-2 space-y-1">
                <li>Reverse all inventory adjustments</li>
                <li>Make tracked entities available again</li>
                <li>Update source document quantities</li>
                <li>Create audit trail entries</li>
              </ul>
            </AlertDescription>
          </Alert>
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="solid" onClick={onClose}>
              Cancel
            </Button>
            <fetcher.Form
              action={path.to.shipmentVoid(shipmentId)}
              method="post"
              onSubmit={() => {
                submitted.current = true;
              }}
            >
              <Button
                variant="destructive"
                isLoading={fetcher.state !== "idle"}
                isDisabled={
                  fetcher.state !== "idle" ||
                  navigation.state !== "idle"
                }
                type="submit"
              >
                Void Shipment
              </Button>
            </fetcher.Form>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ShipmentVoidModal;