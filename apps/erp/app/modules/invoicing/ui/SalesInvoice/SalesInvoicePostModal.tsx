import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
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

import type { FetcherWithComponents } from "@remix-run/react";
import { useEffect, useState } from "react";
import { CustomerContact, SelectControlled } from "~/components/Form";
import { useIntegrations } from "~/hooks/useIntegrations";
import { path } from "~/utils/path";
import { salesInvoicePostValidator } from "../../invoicing.models";

type SalesInvoicePostModalProps = {
  fetcher: FetcherWithComponents<{ success: boolean; message: string }>;
  isOpen: boolean;
  onClose: () => void;
  invoiceId: string;
  linesToShip: {
    itemId: string | null;
    itemReadableId: string | null;
    description: string | null;
    quantity: number;
  }[];
  customerId: string | null;
  customerContactId: string | null;
};

const SalesInvoicePostModal = ({
  fetcher,
  isOpen,
  onClose,
  invoiceId,
  linesToShip,
  customerId,
  customerContactId,
}: SalesInvoicePostModalProps) => {
  const hasLinesToShip = linesToShip.length > 0;
  const integrations = useIntegrations();
  const canEmail = integrations.has("resend");

  const [notificationType, setNotificationType] = useState(
    canEmail ? "Email" : "None"
  );

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
        <ValidatedForm
          method="post"
          validator={salesInvoicePostValidator}
          action={path.to.salesInvoicePost(invoiceId)}
          defaultValues={{
            notification: notificationType as "Email" | "None",
            customerContact: customerContactId ?? undefined,
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>Post Invoice</ModalTitle>
            <ModalDescription>
              {hasLinesToShip ? (
                <>
                  A shipment will be automatically created and posted for the
                  items below.
                </>
              ) : (
                <>Are you sure you want to post this invoice?</>
              )}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              {hasLinesToShip && (
                <div className="w-full">
                  <Table>
                    <Thead>
                      <Tr>
                        <Th>Item</Th>
                        <Th className="text-right">Quantity</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {linesToShip.map((line) => (
                        <Tr key={line.itemId} className="text-sm">
                          <Td>
                            <VStack spacing={0}>
                              <span>{line.itemReadableId}</span>
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
              )}

              {canEmail && (
                <SelectControlled
                  label="Send Via"
                  name="notification"
                  options={[
                    {
                      label: "None",
                      value: "None",
                    },
                    {
                      label: "Email",
                      value: "Email",
                    },
                  ]}
                  value={notificationType}
                  onChange={(t) => {
                    if (t) setNotificationType(t.value);
                  }}
                />
              )}

              {notificationType === "Email" && (
                <CustomerContact
                  name="customerContact"
                  customer={customerId ?? undefined}
                />
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
                type="submit"
              >
                {hasLinesToShip ? "Post and Ship Invoice" : "Post Invoice"}
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default SalesInvoicePostModal;
