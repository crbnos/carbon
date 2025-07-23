import {
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
  toast,
  Tr,
  VStack,
} from "@carbon/react";

import { useFetcher } from "@remix-run/react";
import { useEffect } from "react";
import type { action } from "~/routes/x+/purchase-invoice+/$invoiceId.post";
import { useItems } from "~/stores";
import { getItemReadableId } from "~/utils/items";
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
  linesToReceive,
}: PurchaseInvoicePostModalProps) => {
  const [items] = useItems();
  const hasLinesToReceive = linesToReceive.length > 0;

  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    } else if (fetcher.data?.success === false && fetcher.data?.message) {
      toast.error(fetcher.data.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
              <p>
                Are you sure you want to post this invoice? A receipt will be
                automatically created and posted for:
              </p>
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
              <Button
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
                type="submit"
              >
                {hasLinesToReceive
                  ? "Post and Receive Invoice"
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
