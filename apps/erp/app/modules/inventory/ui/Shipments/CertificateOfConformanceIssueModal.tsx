import { ValidatedForm } from "@carbon/form";
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
  ModalTitle,
  Spinner,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  Boolean,
  CustomerContact,
  EmailRecipients,
  TextArea
} from "~/components/Form";
import { useIntegrations } from "~/hooks/useIntegrations";
import { path } from "~/utils/path";
import { certificateOfConformanceIssueValidator } from "../../inventory.models";
import type { CertificateOfConformanceWarnings } from "../../types";

type CertificateOfConformanceIssueModalProps = {
  shipmentId: string;
  /** A revision already exists: this is a reissue and needs a reason. */
  isReissue: boolean;
  customerId: string | null;
  defaultContactId: string | null;
  onClose: () => void;
};

const CertificateOfConformanceIssueModal = ({
  shipmentId,
  isReissue,
  customerId,
  defaultContactId,
  onClose
}: CertificateOfConformanceIssueModalProps) => {
  const { t } = useLingui();
  const integrations = useIntegrations();
  const canEmail = integrations.has("email") && !!customerId;
  const [email, setEmail] = useState(canEmail && !!defaultContactId);

  const fetcher = useFetcher<{ success?: boolean; message?: string }>();
  const warningsFetcher = useFetcher<{
    warnings: CertificateOfConformanceWarnings | null;
  }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per shipment; the fetcher object changes every render.
  useEffect(() => {
    warningsFetcher.load(
      `${path.to.shipmentCertificate(shipmentId)}?warnings=true`
    );
  }, [shipmentId]);

  // The action flashes its own toast; the dialog only has to close.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onClose is stable for the modal's lifetime.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) onClose();
  }, [fetcher.state, fetcher.data]);

  const warnings = warningsFetcher.data?.warnings ?? null;
  const isLoadingWarnings = warningsFetcher.state !== "idle" && !warnings;
  const hasWarnings =
    !!warnings &&
    (warnings.faiDue.length > 0 || warnings.missingCertificates.length > 0);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.shipmentCertificate(shipmentId)}
          validator={certificateOfConformanceIssueValidator}
          defaultValues={{
            reasonForUpdate: "",
            email,
            customerContact: defaultContactId ?? undefined,
            cc: []
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              {isReissue ? (
                <Trans>Reissue Certificate of Conformance</Trans>
              ) : (
                <Trans>Issue Certificate of Conformance</Trans>
              )}
            </ModalTitle>
            <ModalDescription>
              {isReissue ? (
                <Trans>
                  A new revision is issued under the same number. Earlier
                  revisions stay downloadable.
                </Trans>
              ) : (
                <Trans>
                  The certificate is signed by you and stored with the shipment.
                </Trans>
              )}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              {isLoadingWarnings && (
                <HStack className="text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  <span>
                    <Trans>Checking first articles and certificates…</Trans>
                  </span>
                </HStack>
              )}
              {hasWarnings && warnings && (
                <Alert variant="warning">
                  <LuTriangleAlert />
                  <AlertTitle>
                    <Trans>Review before issuing</Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 space-y-1">
                      {warnings.faiDue.map((item) => (
                        <li key={`fai-${item.itemReadableId}`}>
                          {t`First article due for ${item.itemReadableId}`}
                          {item.reason ? ` (${item.reason})` : ""}
                        </li>
                      ))}
                      {warnings.missingCertificates.map((name) => (
                        <li key={`cert-${name}`}>
                          {t`No certificate on file for ${name}`}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              {isReissue && (
                <TextArea
                  name="reasonForUpdate"
                  label={t`Reason for Update`}
                  isRequired
                />
              )}
              {canEmail && (
                <Boolean
                  name="email"
                  label={t`Email to customer`}
                  value={email}
                  onChange={setEmail}
                />
              )}
              {canEmail && email && (
                <>
                  <CustomerContact
                    name="customerContact"
                    customer={customerId ?? undefined}
                  />
                  <EmailRecipients name="cc" label={t`CC`} type="employee" />
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                type="submit"
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                {isReissue ? <Trans>Reissue</Trans> : <Trans>Issue</Trans>}
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default CertificateOfConformanceIssueModal;
