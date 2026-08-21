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
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import type { FetcherWithComponents } from "react-router";
import { useFetcher } from "react-router";
import {
  CustomerContact,
  DatePicker,
  EmailRecipients,
  Hidden,
  SelectControlled
} from "~/components/Form";
import { useCompanyToday } from "~/hooks";
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
  dateDue: string | null;
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
  dateDue,
  defaultCc = []
}: SalesInvoicePostModalProps) => {
  const { t } = useLingui();
  const hasLinesToShip = linesToShip.length > 0;
  const integrations = useIntegrations();
  const canEmail = integrations.has("email");
  const canStripe = integrations.has("stripe-connect");

  // The invoice's own dateDue is a business date, so the "would this survive
  // clampDueDate" check anchors on the company's calendar, not the browser's.
  const companyToday = parseDate(useCompanyToday());
  const minStripeDueDate = companyToday.add({ days: 1 });
  const maxStripeDueDate = companyToday.add({ years: 5 });
  const parsedDateDue = (() => {
    if (!dateDue) return null;
    try {
      return parseDate(dateDue.slice(0, 10));
    } catch {
      return null;
    }
  })();
  // Mirrors clampDueDate's server-side rule (missing, on/before today, or
  // more than 5 years out) — if the invoice's own date wouldn't survive that
  // clamp, ask the user for one instead of silently sending with none.
  const needsStripeDueDate =
    !parsedDateDue ||
    parsedDateDue.compare(companyToday) <= 0 ||
    parsedDateDue.compare(maxStripeDueDate) > 0;

  const [notificationType, setNotificationType] = useState<
    "Email" | "Stripe" | "None"
  >(canStripe ? "Stripe" : canEmail ? "Email" : "None");

  const [contactId, setContactId] = useState<string | null>(customerContactId);
  const [stripeEmail, setStripeEmail] = useState("");
  const [committedEmail, setCommittedEmail] = useState<string | undefined>();
  const stripeCustomer = useFetcher<StripeCustomerResolution>();
  const isStripe = notificationType === "Stripe";
  // The identity the current panel state must correspond to. Anything the
  // fetcher still holds for a different key is stale.
  const requestKey = `${contactId ?? ""}|${committedEmail ?? ""}`;
  const loadedKeyRef = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `stripeCustomer` is a fresh object each render, so depending on it would re-run this effect forever.
  useEffect(() => {
    if (!isStripe || !contactId) return;
    loadedKeyRef.current = requestKey;
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
  const isStale = loadedKeyRef.current !== requestKey;
  const isResolving = stripeCustomer.state !== "idle" || isStale;

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
            cc: defaultCc,
            stripeDueDate:
              isStripe && needsStripeDueDate
                ? companyToday.add({ days: 30 }).toString()
                : undefined
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
              {isStripe && committedEmail && (
                <Hidden name="stripeContactEmail" value={committedEmail} />
              )}
              {isStripe && needsStripeDueDate && (
                <DatePicker
                  name="stripeDueDate"
                  label={t`Stripe Due Date`}
                  helperText={t`This invoice has no usable due date — choose one for Stripe.`}
                  minValue={minStripeDueDate}
                  maxValue={maxStripeDueDate}
                  isRequired
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
