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
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  VStack
} from "@carbon/react";

import { getItemReadableId } from "@carbon/utils";
import { useEffect, useMemo } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { useItems } from "~/stores";
import { Result } from "~/types";
import { path } from "~/utils/path";

type PurchaseInvoicePostModalProps = {
  isOpen: boolean;
  onClose: () => void;
  invoiceId: string;
  linesToReceive: {
    itemId: string | null;
    description: string | null;
    quantity: number;
  }[];
};

const PurchaseInvoicePostModal = ({
  isOpen,
  onClose,
  invoiceId,
  linesToReceive
}: PurchaseInvoicePostModalProps) => {
  const [items] = useItems();
  const navigate = useNavigate();
  const hasLinesToReceive = linesToReceive.length > 0;

  const hasTrackedItems = useMemo(() => {
    return linesToReceive.some((line) => {
      const item = items.find((i) => i.id === line.itemId);
      return (
        item?.itemTrackingType === "Serial" ||
        item?.itemTrackingType === "Batch"
      );
    });
  }, [linesToReceive, items]);

  const fetcher = useFetcher<Result & { receiptId?: string }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (fetcher.data?.success) {
      if (fetcher.data.receiptId) {
        navigate(path.to.receipt(fetcher.data.receiptId));
      }
      onClose();
    } else if (fetcher.data?.success === false && fetcher.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.success]);

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Post Invoice</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {hasLinesToReceive ? (
            <div className="gap-4 w-full flex flex-col">
              {hasTrackedItems ? (
                <>
                  <p>
                    Are you sure you want to post this invoice? A receipt will
                    be created for:
                  </p>
                  <Alert variant="destructive">
                    <LuTriangleAlert className="h-4 w-4" />
                    <AlertTitle>Serial or Batch Tracking Required</AlertTitle>
                    <AlertDescription>
                      Some items require serial or batch tracking. The receipt
                      will be created but not posted. You will be redirected to
                      the receipt to enter tracking information.
                    </AlertDescription>
                  </Alert>
                </>
              ) : (
                <p>
                  Are you sure you want to post this invoice? A receipt will be
                  automatically created and posted for:
                </p>
              )}
              <Table>
                <Thead>
                  <Tr>
                    <Th>Item</Th>
                    <Th className="text-right">Quantity</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {linesToReceive.map((line) => (
                    <Tr key={line.itemId} className="text-sm">
                      <Td>
                        <VStack spacing={0}>
                          <span>
                            {getItemReadableId(items, line.itemId) ?? ""}
                          </span>
                          {line.description && (
                            <span className="text-xs text-muted-foreground">
                              {line.description}
                            </span>
                          )}
                        </VStack>
                      </Td>
                      <Td className="text-right">{line.quantity}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          ) : (
            <p>Are you sure you want to post this invoice?</p>
          )}
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="solid" onClick={onClose}>
              Cancel
            </Button>
            <fetcher.Form
              method="post"
              action={path.to.purchaseInvoicePost(invoiceId)}
            >
              {hasTrackedItems && (
                <input type="hidden" name="skipReceiptPost" value="true" />
              )}
              <Button
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
                type="submit"
              >
                {hasLinesToReceive
                  ? hasTrackedItems
                    ? "Post and Create Receipt"
                    : "Post and Receive Invoice"
                  : "Post Invoice"}
              </Button>
            </fetcher.Form>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default PurchaseInvoicePostModal;
