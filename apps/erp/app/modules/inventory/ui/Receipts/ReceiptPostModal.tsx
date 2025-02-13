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
import { Form, useNavigation, useParams } from "@remix-run/react";
import { useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { path } from "~/utils/path";

const ReceiptPostModal = ({ onClose }: { onClose: () => void }) => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const navigation = useNavigation();
  const { carbon } = useCarbon();
  const [validated, setValidated] = useState(false);
  const [validationErrors, setValidationErrors] = useState<
    {
      itemReadableId: string | null;
      receivedQuantity: number;
      receivedQuantityError: string;
    }[]
  >([]);

  const getReceiptLines = async () => {
    if (!carbon) {
      toast.error("Carbon client not found");
      return;
    }
    const [receiptLines, receiptLineTracking] = await Promise.all([
      carbon
        .from("receiptLine")
        .select(
          "id, itemReadableId, receivedQuantity, requiresBatchTracking, requiresSerialTracking"
        )
        .eq("receiptId", receiptId),
      carbon
        .from("itemTracking")
        .select("*, serialNumber(number), batchNumber(number)")
        .eq("sourceDocument", "Receipt")
        .eq("sourceDocumentId", receiptId),
    ]);

    if (receiptLines.error || receiptLineTracking.error) {
      toast.error("Error fetching receipt lines or tracking data");
      return;
    }

    const errors: {
      itemReadableId: string | null;
      receivedQuantity: number;
      receivedQuantityError: string;
    }[] = [];

    const receiptLinesWithTracking = receiptLines.data.map((line) => ({
      ...line,
      receiptLineTracking: receiptLineTracking.data.filter(
        (tracking) => tracking.sourceDocumentLineId === line.id
      ),
    }));

    receiptLinesWithTracking.forEach((line) => {
      if (
        line.requiresBatchTracking &&
        (line.receiptLineTracking.length === 0 ||
          !line.receiptLineTracking[0].batchNumber)
      ) {
        errors.push({
          itemReadableId: line.itemReadableId,
          receivedQuantity: line.receivedQuantity,
          receivedQuantityError: "Batch number is required",
        });
      }

      if (line.requiresSerialTracking) {
        const quantityWithSerial = line.receiptLineTracking.reduce(
          (acc, tracking) => acc + tracking.quantity,
          0
        );
        if (quantityWithSerial !== line.receivedQuantity) {
          errors.push({
            itemReadableId: line.itemReadableId,
            receivedQuantity: line.receivedQuantity,
            receivedQuantityError: "Serial numbers are missing",
          });
        }
      }
    });

    setValidationErrors(errors);
    setValidated(true);
  };

  useMount(() => {
    getReceiptLines();
  });

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
          <ModalTitle>Post Receipt</ModalTitle>
          <ModalDescription>
            Are you sure you want to post this receipt?
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
          )}
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="solid" onClick={onClose}>
              Cancel
            </Button>
            <Form action={path.to.receiptPost(receiptId)} method="post">
              <Button
                isDisabled={
                  navigation.state !== "idle" ||
                  !validated ||
                  validationErrors.length > 0
                }
                type="submit"
              >
                Post Receipt
              </Button>
            </Form>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ReceiptPostModal;
