import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack,
} from "@carbon/react";
import type { FetcherWithComponents } from "@remix-run/react";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import { CustomerContact, SelectControlled } from "~/components/Form";
import { useIntegrations } from "~/hooks/useIntegrations";
import { path } from "~/utils/path";
import { quoteFinalizeValidator } from "../../sales.models";
import type { Quotation } from "../../types";

type QuotationFinalizeModalProps = {
  onClose: () => void;
  quote?: Quotation;
  fetcher: FetcherWithComponents<{}>;
};

const QuotationFinalizeModal = ({
  quote,
  onClose,
  fetcher,
}: QuotationFinalizeModalProps) => {
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("quoteId not found");

  const integrations = useIntegrations();
  const canEmail = integrations.has("resend");

  const [notificationType, setNotificationType] = useState(
    canEmail ? "Email" : "Download"
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          validator={quoteFinalizeValidator}
          action={path.to.quoteFinalize(quoteId)}
          onSubmit={onClose}
          defaultValues={{
            notification: notificationType as "Email" | "None",
            customerContact: quote?.customerContactId ?? undefined,
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>{`Finalize ${quote?.quoteId}`}</ModalTitle>
            <ModalDescription>
              Are you sure you want to finalize the quote?
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
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
                  customer={quote?.customerId ?? undefined}
                />
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Finalize</Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default QuotationFinalizeModal;
