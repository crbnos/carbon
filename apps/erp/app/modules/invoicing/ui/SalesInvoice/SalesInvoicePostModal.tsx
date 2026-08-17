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
  Tr,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import type { FetcherWithComponents } from "react-router";
import { useFetcher } from "react-router";
import {
  CustomerContact,
  EmailRecipients,
  SelectControlled
} from "~/components/Form";
import { useIntegrations } from "~/hooks/useIntegrations";
import type { StripeCustomerResolution } from "~/modules/invoicing/stripe-customer.server";
import { path } from "~/utils/path";
import { salesInvoicePostValidator } from "../../invoicing.models";
import StripeCustomerPanel from "./StripeCustomerPanel";

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
  defaultCc?: string[];
};

const SalesInvoicePostModal = ({
  fetcher,
  isOpen,
  onClose,
  invoiceId,
  linesToShip,
  customerId,
  customerContactId,
  defaultCc = []
}: SalesInvoicePostModalProps) => {
  const { t } = useLingui();
  const hasLinesToShip = linesToShip.length > 0;
  const integrations = useIntegrations();
  const canEmail = integrations.has("email");
  const canStripe = integrations.has("stripe-connect");

  const [notificationType, setNotificationType] = useState<
    "Email" | "Stripe" | "None"
  >(canStripe ? "Stripe" : canEmail ? "Email" : "None");

  const [contactId, setContactId] = useState<string | null>(customerContactId);
  // What the user is typing, vs. the address the resolution has actually been
  // run against. Split so every keystroke doesn't hit Stripe — the committed
  // value only moves on blur.
  const [stripeEmail, setStripeEmail] = useState("");
  const [committedEmail, setCommittedEmail] = useState<string | undefined>();

  // Resolves the Carbon customer against the connected account so the user can
  // see — and choose — what posting would do before it happens.
  const stripeCustomer = useFetcher<StripeCustomerResolution>();
  const isStripe = notificationType === "Stripe";

  // biome-ignore lint/correctness/useExhaustiveDependencies: `stripeCustomer` is a fresh object each render, so depending on it would re-run this effect forever.
  useEffect(() => {
    if (!isStripe || !contactId) return;
    stripeCustomer.load(
      path.to.api.stripeConnectCustomer(invoiceId, contactId, committedEmail)
    );
  }, [isStripe, contactId, invoiceId, committedEmail]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (fetcher.data?.success) {
      if (fetcher.data?.message) toast.success(fetcher.data.message);
      onClose();
    } else if (fetcher.data?.success === false && fetcher.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data?.success]);

  const resolution = stripeCustomer.data ?? null;
  const isResolving = stripeCustomer.state !== "idle";

  // Nothing may be created on a merchant's Stripe account without a decision,
  // so the submit stays shut until the panel has produced one.
  const isStripeBlocked =
    isStripe &&
    (!contactId ||
      isResolving ||
      !resolution ||
      resolution.state === "unavailable" ||
      resolution.state === "missing-email");

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
            notification: notificationType,
            customerContact: customerContactId ?? undefined,
            cc: defaultCc
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Post Invoice</Trans>
            </ModalTitle>
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
                        <Th>
                          <Trans>Item</Trans>
                        </Th>
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

              {(canEmail || canStripe) && (
                <SelectControlled
                  label={t`Send Via`}
                  name="notification"
                  options={[
                    {
                      label: "None",
                      value: "None"
                    },
                    ...(canEmail
                      ? [
                          {
                            label: "Email",
                            value: "Email"
                          }
                        ]
                      : []),
                    ...(canStripe
                      ? [
                          {
                            label: "Stripe",
                            value: "Stripe"
                          }
                        ]
                      : [])
                  ]}
                  value={notificationType}
                  onChange={(t) => {
                    if (t)
                      setNotificationType(
                        t.value as "Email" | "Stripe" | "None"
                      );
                  }}
                />
              )}

              {(notificationType === "Email" ||
                notificationType === "Stripe") && (
                <CustomerContact
                  name="customerContact"
                  customer={customerId ?? undefined}
                  onChange={(contact) => {
                    setContactId(contact?.id ?? null);
                    // A different contact may have an email of its own, so
                    // drop anything typed for the previous one.
                    setStripeEmail("");
                    setCommittedEmail(undefined);
                  }}
                />
              )}
              {isStripe && contactId && (
                <StripeCustomerPanel
                  resolution={resolution}
                  isLoading={isResolving}
                  email={stripeEmail}
                  onEmailChange={setStripeEmail}
                  onEmailCommit={(email) => {
                    // Re-resolve once an address exists: Stripe may already
                    // have a customer under it, and linking beats duplicating.
                    if (email.includes("@")) setCommittedEmail(email);
                  }}
                />
              )}
              {notificationType === "Email" && (
                <EmailRecipients name="cc" label={t`CC`} type="employee" />
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                isDisabled={fetcher.state !== "idle" || isStripeBlocked}
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
