import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Checkbox,
  Copy,
  HStack,
  Input,
  InputGroup,
  InputRightElement,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { useState } from "react";
import type { FetcherWithComponents } from "react-router";
import {
  EmailRecipients,
  SelectControlled,
  SupplierContact
} from "~/components/Form";
import { useIntegrations } from "~/hooks/useIntegrations";
import { path } from "~/utils/path";
import { supplierQuoteFinalizeValidator } from "../../purchasing.models";
import type { SupplierQuote } from "../../types";

type SupplierQuoteSendModalProps = {
  onClose: () => void;
  quote?: SupplierQuote;
  fetcher: FetcherWithComponents<{}>;
  externalLinkId?: string;
  defaultCc?: string[];
};

const SupplierQuoteSendModal = ({
  quote,
  onClose,
  fetcher,
  externalLinkId,
  defaultCc = []
}: SupplierQuoteSendModalProps) => {
  const integrations = useIntegrations();
  const canEmail = integrations.has("resend");

  const [notificationType, setNotificationType] = useState(
    canEmail ? "Email" : "Share"
  );
  const [sendAttachments, setSendAttachments] = useState(true);

  const digitalQuoteUrl =
    externalLinkId && typeof window !== "undefined"
      ? `${window.location.origin}${path.to.externalSupplierQuote(
          externalLinkId
        )}`
      : "";

  if (!canEmail) {
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
          <ModalHeader>
            <ModalTitle>Send {quote?.supplierQuoteId}</ModalTitle>
            <ModalDescription>
              Copy this link to share the quote with a supplier
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <InputGroup>
              <Input value={digitalQuoteUrl} isReadOnly />
              <InputRightElement>
                <Copy text={digitalQuoteUrl} />
              </InputRightElement>
            </InputGroup>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    );
  }

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
          validator={supplierQuoteFinalizeValidator}
          action={path.to.supplierQuoteSend(quote?.id || "")}
          onSubmit={onClose}
          defaultValues={{
            notification: notificationType as "Email" | "Share",
            supplierContact: quote?.supplierContactId ?? undefined,
            sendAttachments: sendAttachments,
            cc: defaultCc
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>Send {quote?.supplierQuoteId}</ModalTitle>
            <ModalDescription>
              Share the supplier quote via link or email.
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
                      label: "Share Link",
                      value: "Share"
                    },
                    {
                      label: "Email",
                      value: "Email"
                    }
                  ]}
                  value={notificationType}
                  onChange={(t) => {
                    if (t) setNotificationType(t.value);
                  }}
                />
              )}
              {notificationType === "Share" && (
                <VStack spacing={2} className="w-full items-start">
                  <Label htmlFor="digitalQuoteUrl">
                    <span className="text-xs font-medium text-muted-foreground">
                      Share Link
                    </span>
                  </Label>
                  <InputGroup>
                    <Input
                      id="digitalQuoteUrl"
                      value={digitalQuoteUrl}
                      isReadOnly
                    />
                    <InputRightElement>
                      <Copy text={digitalQuoteUrl} />
                    </InputRightElement>
                  </InputGroup>
                </VStack>
              )}
              {notificationType === "Email" && (
                <>
                  <SupplierContact
                    name="supplierContact"
                    supplier={quote?.supplierId ?? undefined}
                  />
                  <EmailRecipients name="cc" label="CC" type="employee" />
                  <HStack spacing={2}>
                    <Checkbox
                      id="sendAttachments"
                      name="sendAttachments"
                      isChecked={sendAttachments}
                      onCheckedChange={(checked) =>
                        setSendAttachments(checked === true)
                      }
                    />
                    <label htmlFor="sendAttachments" className="text-sm">
                      Send documents attached to line items
                    </label>
                  </HStack>
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            {notificationType === "Share" ? (
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit">Send</Button>
              </>
            )}
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default SupplierQuoteSendModal;
