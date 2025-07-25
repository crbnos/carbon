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
import type { TrackedEntityAttributes } from "@carbon/utils";
import { useFetcher, useNavigation, useParams } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useUser } from "~/hooks";
import { useItems } from "~/stores";
import { getItemReadableId } from "~/utils/items";
import { path } from "~/utils/path";
import { getReceiptTracking } from "../../inventory.service";
import type { ReceiptLine } from "../../types";

const ReceiptPostModal = ({ onClose }: { onClose: () => void }) => {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");

  const [items] = useItems();
  const routeData = useRouteData<{
    receiptLines: ReceiptLine[];
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
    company: { id: companyId },
  } = useUser();

  const validateReceiptTracking = async () => {
    const errors: {
      itemReadableId: string | null;
      receivedQuantity: number;
      receivedQuantityError: string;
    }[] = [];

    if (!carbon) {
      toast.error("Carbon client is not available");
      return;
    }

    const receiptLineTracking = await getReceiptTracking(
      carbon,
      receiptId,
      companyId
    );

    if (
      routeData?.receiptLines.length === 0 ||
      routeData?.receiptLines.every((line) => line.receivedQuantity === 0)
    ) {
      setValidationErrors([
        {
          itemReadableId: null,
          receivedQuantity: 0,
          receivedQuantityError: "Receipt is empty",
        },
      ]);
    }

    routeData?.receiptLines.forEach((line: ReceiptLine) => {
      if (line.requiresBatchTracking) {
        if (line.receivedQuantity === 0) return;
        const trackedEntity = receiptLineTracking.data?.find((tracking) => {
          const attributes = tracking.attributes as TrackedEntityAttributes;
          return attributes["Receipt Line"] === line.id;
        });

        const attributes = trackedEntity?.attributes as
          | TrackedEntityAttributes
          | undefined;
        if (!attributes?.["Batch Number"]) {
          errors.push({
            itemReadableId: getItemReadableId(items, line.itemId) ?? null,
            receivedQuantity: line.receivedQuantity ?? 0,
            receivedQuantityError: "Batch number is required",
          });
        }
      }

      if (line.requiresSerialTracking) {
        if (line.receivedQuantity === 0) return;
        const trackedEntities = receiptLineTracking.data?.filter((tracking) => {
          const attributes = tracking.attributes as TrackedEntityAttributes;
          return attributes["Receipt Line"] === line.id;
        });

        const quantityWithSerial = trackedEntities?.reduce((acc, tracking) => {
          const attributes = tracking.attributes as TrackedEntityAttributes;
          const serialNumber = attributes["Serial Number"];

          return acc + (serialNumber ? 1 : 0);
        }, 0);

        if (quantityWithSerial !== line.receivedQuantity) {
          errors.push({
            itemReadableId: getItemReadableId(items, line.itemId) ?? null,
            receivedQuantity: line.receivedQuantity ?? 0,
            receivedQuantityError: "Serial numbers are missing",
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
            <fetcher.Form
              action={path.to.receiptPost(receiptId)}
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
                Post Receipt
              </Button>
            </fetcher.Form>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ReceiptPostModal;
