// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Copy,
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
import { Trans, useLingui } from "@lingui/react/macro";
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
import type { SupplierQuote, SupplierQuoteLine } from "../../types";
import SupplierFilesPicker from "./SupplierFilesPicker";

type SupplierQuoteSendModalProps = {
  open?: boolean;
  onClose: () => void;
  quote?: SupplierQuote;
  lines: SupplierQuoteLine[];
  fetcher: FetcherWithComponents<{}>;
  externalLinkId?: string;
  defaultCc?: string[];
};

const SupplierQuoteSendModal = ({
  open = true,
  onClose,
  ...props
}: SupplierQuoteSendModalProps) => (
  <Modal
    open={open}
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
  >
    <ModalContent>
      <SupplierQuoteSendBody onClose={onClose} {...props} />
    </ModalContent>
  </Modal>
);

const SupplierQuoteSendBody = ({
  quote,
  lines,
  onClose,
  fetcher,
  externalLinkId,
  defaultCc = []
}: Omit<SupplierQuoteSendModalProps, "open">) => {
  const { t } = useLingui();
  const integrations = useIntegrations();
  const canEmail = integrations.has("email");

  const [notificationType, setNotificationType] = useState(
    canEmail ? "Email" : "Share"
  );
  const [contactMissingEmail, setContactMissingEmail] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const digitalQuoteUrl =
    externalLinkId && typeof window !== "undefined"
      ? `${window.location.origin}${path.to.externalSupplierQuote(
          externalLinkId
        )}`
      : "";

  if (!canEmail) {
    return (
      <>
        <ModalHeader>
          <ModalTitle>Send {quote?.supplierQuoteId}</ModalTitle>
          <ModalDescription>
            Copy this link to share the quote with a supplier
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <InputGroup>
            <Input
              aria-label={t`Share link`}
              value={digitalQuoteUrl}
              isReadOnly
            />
            <InputRightElement>
              <Copy text={digitalQuoteUrl} />
            </InputRightElement>
          </InputGroup>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Close</Trans>
          </Button>
        </ModalFooter>
      </>
    );
  }

  return (
    <ValidatedForm
      method="post"
      validator={supplierQuoteFinalizeValidator}
      action={path.to.supplierQuoteSend(quote?.id || "")}
      onSubmit={onClose}
      defaultValues={{
        notification: notificationType as "Email" | "Share",
        supplierContact: quote?.supplierContactId ?? undefined,
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
              label={t`Send Via`}
              name="notification"
              options={[
                {
                  label: t`Share Link`,
                  value: "Share"
                },
                {
                  label: t`Email`,
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
                warnIfNoEmail
                onMissingEmailChange={setContactMissingEmail}
              />
              <EmailRecipients name="cc" label={t`CC`} type="employee" />
              <SupplierFilesPicker
                lines={lines}
                onLoadingChange={setFilesLoading}
              />
            </>
          )}
        </VStack>
      </ModalBody>
      <ModalFooter>
        {notificationType === "Share" ? (
          <Button variant="secondary" onClick={onClose}>
            <Trans>Close</Trans>
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="submit"
              isDisabled={
                notificationType === "Email" &&
                (contactMissingEmail || filesLoading)
              }
            >
              <Trans>Send</Trans>
            </Button>
          </>
        )}
      </ModalFooter>
    </ValidatedForm>
  );
};

export default SupplierQuoteSendModal;
