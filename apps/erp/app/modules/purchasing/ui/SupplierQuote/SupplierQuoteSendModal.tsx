// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
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
  const { t } = useLingui();
  const integrations = useIntegrations();
  const canEmail = integrations.has("email");

  const [notificationType, setNotificationType] = useState(
    canEmail ? "Email" : "Share"
  );
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
              <Trans>Close</Trans>
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
                  />
                  <EmailRecipients name="cc" label={t`CC`} type="employee" />
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
                <Button type="submit">
                  <Trans>Send</Trans>
                </Button>
              </>
            )}
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default SupplierQuoteSendModal;
